import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, Ray, Vector3 } from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';

export const PLAYER = Object.freeze({ height: 1.82, radius: 0.32, eye: 1.65, speed: 3.8, gravity: 18, jump: 5.8, step: 0.35 });
const DOWN = new Vector3(0, -1, 0);
const UP = new Vector3(0, 1, 0);
const epsilon = 0.001;
export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export const wrapAngle = value => Math.atan2(Math.sin(value), Math.cos(value));
export function approachAngle(current, target, amount) { return current + clamp(wrapAngle(target - current), -amount, amount); }
export function aimDirection(yaw, pitch = 0, out = new Vector3()) {
  return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}

/** The same triangle/capsule solver is used by the server and client prediction. y means feet. */
export class CollisionWorld {
  constructor(triangles, options = {}) {
    if (!(triangles instanceof Float32Array)) triangles = new Float32Array(triangles || []);
    if (triangles.length % 9) throw new Error('Collision triangles must contain complete XYZ triangles.');
    for (let i = 0; i < triangles.length; i++) if (!Number.isFinite(triangles[i])) throw new Error('Invalid collision coordinate.');
    this.octree = new Octree();
    this.bounds = options.bounds || { minX: -60, maxX: 60, minZ: -50, maxZ: 50, minY: -12, maxY: 30 };
    this.triangleCount = triangles.length / 9;
    if (triangles.length) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(triangles, 3));
      const material = new MeshBasicMaterial();
      this.octree.fromGraphNode(new Mesh(geometry, material));
      geometry.dispose();
      material.dispose();
    }
  }

  capsule(actor) {
    return new Capsule(new Vector3(actor.x, actor.y + PLAYER.radius, actor.z), new Vector3(actor.x, actor.y + PLAYER.height - PLAYER.radius, actor.z), PLAYER.radius);
  }

  resolve(capsule) {
    let ground = false;
    let wall = false;
    for (let i = 0; i < 4; i++) {
      const hit = this.octree.capsuleIntersect(capsule);
      if (!hit || hit.depth < 0.00001) break;
      if (hit.normal.y > 0.5) ground = true;
      if (Math.abs(hit.normal.y) < 0.5) wall = true;
      capsule.translate(hit.normal.multiplyScalar(hit.depth + epsilon));
    }
    return { ground, wall };
  }

  raycast(origin, direction, maxDistance = 200) {
    const hit = this.octree.rayIntersect(new Ray(new Vector3(origin.x, origin.y, origin.z), new Vector3(direction.x, direction.y, direction.z).normalize()));
    return hit && hit.distance <= maxDistance ? hit : null;
  }

  floorPoint(point, searchHeight = 2.5, searchDepth = 8) {
    const hit = this.raycast({ x: point.x, y: point.y + searchHeight, z: point.z }, DOWN, searchHeight + searchDepth);
    return hit && hit.triangle.getNormal(new Vector3()).dot(UP) > 0.45 ? { x: point.x, y: hit.position.y + epsilon, z: point.z } : null;
  }

  visible(from, to) {
    const direction = new Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
    const distance = direction.length();
    return distance < 0.001 || !this.raycast(from, direction.divideScalar(distance), distance - 0.03);
  }

  /** Fixed-step movement. Collision substeps prevent tunnelling. */
  move(actor, input, dt) {
    dt = clamp(dt, 0, 0.05);
    const forward = Number(!!input.forward) - Number(!!input.back);
    const strafe = Number(!!input.right) - Number(!!input.left);
    const magnitude = Math.hypot(forward, strafe) || 1;
    const speed = PLAYER.speed * (actor.reload > 0 ? 0.85 : 1);
    const dx = (-Math.sin(actor.yaw) * forward + Math.cos(actor.yaw) * strafe) / magnitude * speed * dt;
    const dz = (-Math.cos(actor.yaw) * forward - Math.sin(actor.yaw) * strafe) / magnitude * speed * dt;
    const wasGrounded = !!actor.grounded;
    if (input.jump && wasGrounded && !actor.jumpHeld) actor.vy = PLAYER.jump;
    actor.jumpHeld = !!input.jump;
    actor.vy = (Number.isFinite(actor.vy) ? actor.vy : 0) - PLAYER.gravity * dt;
    let capsule = this.capsule(actor);
    capsule.translate(new Vector3(dx, 0, dz));
    const horizontal = this.resolve(capsule);
    // Try a raised candidate to climb low ledges while ordinary movement still slides along walls.
    if (horizontal.wall && wasGrounded && (dx || dz)) {
      const raised = this.capsule(actor);
      raised.translate(new Vector3(0, PLAYER.step, 0));
      if (!this.octree.capsuleIntersect(raised)) {
        raised.translate(new Vector3(dx, 0, dz));
        const raisedHit = this.resolve(raised);
        if (!raisedHit.wall) {
          raised.translate(new Vector3(0, -PLAYER.step, 0));
          this.resolve(raised);
          const regularProgress = (capsule.start.x - actor.x) * dx + (capsule.start.z - actor.z) * dz;
          const raisedProgress = (raised.start.x - actor.x) * dx + (raised.start.z - actor.z) * dz;
          if (raisedProgress > regularProgress + 0.00001) capsule = raised;
        }
      }
    }
    const oldTop = capsule.end.y;
    capsule.translate(new Vector3(0, actor.vy * dt, 0));
    const vertical = this.resolve(capsule);
    actor.grounded = vertical.ground;
    if (vertical.ground && actor.vy < 0) actor.vy = 0;
    if (!vertical.ground && actor.vy > 0 && capsule.end.y < oldTop + actor.vy * dt - 0.001) actor.vy = 0;
    actor.x = capsule.start.x;
    actor.y = capsule.start.y - PLAYER.radius;
    actor.z = capsule.start.z;
    actor.walk = (forward || strafe) && wasGrounded ? 1 : 0;
    return actor;
  }
}

/** Ray against an upright capsule, including both spherical caps. direction must be normalized. */
export function rayActor(origin, direction, actor, maxDistance = 160) {
  const ox = origin.x - actor.x;
  const oz = origin.z - actor.z;
  const radius = PLAYER.radius;
  const bottom = actor.y + radius;
  const top = actor.y + PLAYER.height - radius;
  let nearest = Infinity;
  const a = direction.x ** 2 + direction.z ** 2;
  const b = 2 * (ox * direction.x + oz * direction.z);
  const c = ox ** 2 + oz ** 2 - radius ** 2;
  const disc = b * b - 4 * a * c;
  if (a > 1e-9 && disc >= 0) {
    for (const t of [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)]) {
      const y = origin.y + direction.y * t;
      if (t >= 0 && y >= bottom && y <= top) nearest = Math.min(nearest, t);
    }
  }
  for (const y of [bottom, top]) {
    const oy = origin.y - y;
    const halfB = ox * direction.x + oy * direction.y + oz * direction.z;
    const sphereC = ox ** 2 + oy ** 2 + oz ** 2 - radius ** 2;
    const discriminant = halfB ** 2 - sphereC;
    if (discriminant >= 0) {
      const t = -halfB - Math.sqrt(discriminant);
      if (t >= 0) nearest = Math.min(nearest, t);
    }
  }
  return nearest <= maxDistance ? nearest : null;
}
