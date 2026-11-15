import { PLAYER, aimDirection, approachAngle, clamp, rayActor, wrapAngle } from './world.mjs';

export const TICK_RATE = 30;
export const ROOM_ID = 'contra';
export const RULES = Object.freeze({ teamSize: 5, magazine: 30, reload: 1.8, damage: 25, fireInterval: 1 / 7, respawn: 4, round: 100, fuse: 26, plant: 2, defuse: 3 });
const BOTS = ['VECTOR', 'SIERRA', 'ATLAS', 'NOVA', 'ROOK', 'VIPER', 'ECHO', 'GHOST', 'FALCON', 'COBRA'];
const EMPTY = Object.freeze({ forward: false, back: false, left: false, right: false, fire: false, reload: false, use: false, jump: false });
const distXZ = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const roundNumber = n => Math.round(n * 1000) / 1000;
const finite = (n, fallback = 0) => typeof n === 'number' && Number.isFinite(n) ? n : fallback;
const eye = a => ({ x: a.x, y: a.y + PLAYER.eye, z: a.z });
const point = a => ({ x: a.x, y: a.y, z: a.z });

export function sanitizeInput(raw, previous = EMPTY) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const input = {};
  for (const key of Object.keys(EMPTY)) input[key] = raw[key] === true || raw[key] === 1;
  input.yaw = wrapAngle(finite(raw.yaw, previous.yaw || 0));
  input.pitch = clamp(finite(raw.pitch, previous.pitch || 0), -1.45, 1.45);
  input.seq = Number.isSafeInteger(raw.seq) ? clamp(raw.seq, 0, 2147483647) : (previous.seq || 0);
  return input;
}

export function cleanName(value, fallback = 'PLAYER') {
  return typeof value === 'string' ? value.replace(/[<>\x00-\x1f\x7f]/g, '').trim().slice(0, 20) || fallback : fallback;
}

/** Renderer-free authoritative game state. Supply a CollisionWorld and optional Recast navigation adapter. */
export function createGame({ world, navigation = null, seed = 12345, spawns, sites } = {}) {
  if (!world) throw new Error('A collision world is required.');
  let rng = seed >>> 0;
  const random = () => { rng = (Math.imul(1664525, rng) + 1013904223) >>> 0; return rng / 4294967296; };
  const spawnSets = spawns || navigation?.spawns || {
    blue: [{ x: -15, y: 0, z: 12 }], red: [{ x: 15, y: 0, z: -12 }],
  };
  const bombSites = sites || navigation?.sites || { A: { x: -14, y: 0, z: -12 }, B: { x: 14, y: 0, z: 12 } };
  const actors = [];
  const score = { blue: 0, red: 0 };
  const round = { number: 1, phase: 'live', seconds: RULES.round, winner: null, reason: null, nextIn: 0 };
  const bomb = { status: 'carried', carrierId: null, x: 0, y: 0, z: 0, site: null, targetSite: 'A', seconds: 0, plantProgress: 0, defuseProgress: 0, userId: null };
  let time = 0, tick = 0, eventId = 0, nextHuman = 1;
  const events = [];
  const emit = (type, detail = {}) => {
    events.push({ id: ++eventId, type, time: roundNumber(time), ...detail });
    if (events.length > 50) events.shift();
  };

  function spawn(actor, initial = false) {
    const team = actors.filter(a => a.team === actor.team);
    const index = Math.max(0, team.indexOf(actor));
    const choices = spawnSets[actor.team] || [];
    const source = choices[index % choices.length] || { x: actor.team === 'blue' ? -15 : 15, y: 0, z: 0 };
    let position = { x: source.x, y: source.y || 0, z: source.z };
    if (choices.length < RULES.teamSize) {
      const candidate = { x: position.x + Math.cos(index * 2.4) * (index ? 1.8 : 0), y: position.y, z: position.z + Math.sin(index * 2.4) * (index ? 1.8 : 0) };
      position = navigation?.nearestPoint?.(candidate) || world.floorPoint(candidate, 1, 3) || position;
    }
    const onFloor = world.floorPoint(position, 0.6, 2);
    if (onFloor) position.y = onFloor.y;
    Object.assign(actor, position, { alive: true, hp: 100, ammo: RULES.magazine, reload: 0, vy: 0, yaw: actor.team === 'blue' ? Math.PI : 0, pitch: 0, grounded: false, walk: 0, respawnIn: 0, cooldown: 0, jumpHeld: false, protectedUntil: time + (initial ? 1 : 1.5), input: { ...EMPTY }, inputAt: time, path: [], nextPath: 0, stuck: 0 });
    if (!initial) emit('respawn', { actorId: actor.id });
  }

  function makeActor(index) {
    const actor = { id: `bot-${index + 1}`, name: BOTS[index], team: index < 5 ? 'blue' : 'red', bot: true, kills: 0, deaths: 0, slot: index, aiPhase: random() * Math.PI * 2, targetId: null, targetSince: 0, lastSeq: 0 };
    actors.push(actor);
    return actor;
  }
  for (let i = 0; i < 10; i++) makeActor(i);
  for (const actor of actors) spawn(actor, true);

  function assignBomb() {
    const carrier = actors.find(a => a.team === 'red' && a.alive);
    Object.assign(bomb, { status: 'carried', carrierId: carrier?.id || null, site: null, targetSite: round.number % 2 ? 'A' : 'B', seconds: 0, plantProgress: 0, defuseProgress: 0, userId: null });
    if (carrier) Object.assign(bomb, point(carrier));
  }
  assignBomb();

  function join(name) {
    const count = { blue: 0, red: 0 };
    for (const actor of actors) if (!actor.bot) count[actor.team]++;
    const desired = count.blue <= count.red ? 'blue' : 'red';
    const actor = actors.find(a => a.bot && a.team === desired) || actors.find(a => a.bot);
    if (!actor) return null;
    const oldId = actor.id;
    actor.id = `player-${nextHuman++}`;
    actor.name = cleanName(name, `PLAYER ${nextHuman - 1}`);
    actor.bot = false;
    actor.kills = actor.deaths = 0;
    spawn(actor, true);
    if (bomb.carrierId === oldId) bomb.carrierId = actor.id;
    emit('join', { actorId: actor.id, name: actor.name, team: actor.team });
    return actor;
  }

  function leave(id) {
    const actor = actors.find(a => a.id === id && !a.bot);
    if (!actor) return;
    actor.id = `bot-${actor.slot + 1}`;
    actor.name = BOTS[actor.slot];
    actor.bot = true;
    actor.kills = actor.deaths = 0;
    actor.input = { ...EMPTY };
    if (bomb.carrierId === id) bomb.carrierId = actor.id;
    emit('leave', { actorId: id });
  }

  function input(id, raw) {
    const actor = actors.find(a => a.id === id && !a.bot);
    if (!actor) return false;
    actor.input = sanitizeInput(raw, actor.input);
    actor.inputAt = time;
    actor.lastSeq = actor.input.seq;
    return true;
  }

  function endRound(winner, reason) {
    if (round.phase !== 'live') return;
    score[winner]++;
    Object.assign(round, { phase: 'ended', winner, reason, nextIn: 5 });
    emit('roundEnd', { winner, reason, number: round.number });
  }

  function kill(actor, shooter = null) {
    if (!actor.alive) return;
    Object.assign(actor, { alive: false, hp: 0, deaths: actor.deaths + 1, respawnIn: RULES.respawn, walk: 0, reload: 0 });
    if (shooter) shooter.kills++;
    if (bomb.carrierId === actor.id && bomb.status === 'carried') {
      Object.assign(bomb, { status: 'dropped', carrierId: null, plantProgress: 0, userId: null, ...point(actor) });
      emit('bombDropped', { actorId: actor.id });
    }
    emit('kill', { actorId: actor.id, attackerId: shooter?.id || null, attacker: shooter?.name || null, victim: actor.name, team: shooter?.team || null });
  }

  function shoot(actor) {
    if (actor.cooldown > 0 || actor.reload > 0 || !actor.alive || actor.ammo <= 0) return;
    actor.ammo--;
    actor.cooldown = RULES.fireInterval;
    const spread = actor.bot ? 0.018 : 0.0025;
    const direction = aimDirection(actor.yaw + (random() - 0.5) * spread, actor.pitch + (random() - 0.5) * spread);
    const origin = eye(actor);
    const worldHit = world.raycast(origin, direction, 150);
    let distance = worldHit?.distance || 150;
    let victim = null;
    for (const other of actors) {
      if (!other.alive || other.team === actor.team || other.protectedUntil > time) continue;
      const hit = rayActor(origin, direction, other, distance);
      if (hit !== null && hit < distance) { distance = hit; victim = other; }
    }
    const endpoint = { x: roundNumber(origin.x + direction.x * distance), y: roundNumber(origin.y + direction.y * distance), z: roundNumber(origin.z + direction.z * distance) };
    emit('shot', { actorId: actor.id, team: actor.team, from: { x: roundNumber(origin.x), y: roundNumber(origin.y), z: roundNumber(origin.z) }, to: endpoint, hitId: victim?.id || null });
    if (victim) {
      victim.hp = Math.max(0, victim.hp - RULES.damage);
      emit('hit', { actorId: victim.id, attackerId: actor.id, damage: RULES.damage });
      if (victim.hp <= 0) kill(victim, actor);
    }
  }

  function botInput(actor, dt) {
    const controls = { ...EMPTY, yaw: actor.yaw, pitch: actor.pitch };
    const origin = eye(actor);
    const candidates = actors.filter(a => a.alive && a.team !== actor.team && a.protectedUntil <= time && distXZ(a, actor) < 48).sort((a, b) => distXZ(a, actor) - distXZ(b, actor));
    const enemy = candidates.find(a => world.visible(origin, { x: a.x, y: a.y + 1.15, z: a.z }));
    if (enemy?.id !== actor.targetId) { actor.targetId = enemy?.id || null; actor.targetSince = time; }
    const carrier = actors.find(a => a.id === bomb.carrierId);
    let destination;
    if (bomb.status === 'planted') destination = bomb;
    else if (actor.team === 'red') destination = bomb.status === 'dropped' ? bomb : bombSites[bomb.targetSite];
    else destination = enemy || bombSites[(actor.slot % 2) ? 'B' : 'A'];
    let using = false;
    if (actor.team === 'red' && carrier?.id === actor.id && bomb.status === 'carried' && distXZ(actor, destination) < 2.1) using = true;
    if (actor.team === 'blue' && bomb.status === 'planted' && distXZ(actor, bomb) < 2.1) using = true;
    controls.use = using;
    if (actor.ammo === 0 || actor.ammo < 8 && !enemy) controls.reload = true;
    // Route queries are bounded and cached. Never teleport a stuck bot through the map.
    if (time >= actor.nextPath && !using) {
      actor.nextPath = time + 0.8 + random() * 0.4;
      try { actor.path = navigation?.findPath?.(point(actor), point(destination))?.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).slice(0, 256) || []; }
      catch { actor.path = []; }
      while (actor.path.length && distXZ(actor, actor.path[0]) < 0.7) actor.path.shift();
    }
    while (actor.path.length && distXZ(actor, actor.path[0]) < 0.65 && Math.abs(actor.y - actor.path[0].y) < 1.1) actor.path.shift();
    const waypoint = actor.path[0];
    if (waypoint && !using && distXZ(actor, destination) > (enemy ? 7 : 1.3)) {
      const walkYaw = Math.atan2(actor.x - waypoint.x, actor.z - waypoint.z);
      if (!enemy) controls.yaw = walkYaw;
      const relative = wrapAngle(walkYaw - (enemy ? actor.yaw : controls.yaw));
      controls.forward = Math.cos(relative) > 0.3;
      controls.back = Math.cos(relative) < -0.3;
      controls.right = Math.sin(relative) < -0.3;
      controls.left = Math.sin(relative) > 0.3;
      if (actor.stuck > 1.0 && waypoint.y > actor.y + 0.2) controls.jump = time % 1.2 < 0.12;
    }
    if (enemy) {
      const dx = enemy.x - actor.x, dz = enemy.z - actor.z;
      controls.yaw = Math.atan2(-dx, -dz) + Math.sin(time * 4.1 + actor.aiPhase) * 0.013;
      controls.pitch = Math.atan2(enemy.y + 1.15 - origin.y, Math.hypot(dx, dz));
      controls.fire = time - actor.targetSince > 0.35 && Math.abs(wrapAngle(controls.yaw - actor.yaw)) < 0.12 && random() < 0.6 && !using;
    } else controls.pitch = 0;
    return controls;
  }

  function updateBomb(dt) {
    if (bomb.status === 'carried') {
      const carrier = actors.find(a => a.id === bomb.carrierId && a.alive);
      if (carrier) {
        Object.assign(bomb, point(carrier));
        const site = Object.keys(bombSites).find(key => distXZ(carrier, bombSites[key]) < 2.4 && Math.abs(carrier.y - bombSites[key].y) < 2);
        if (carrier.input.use && site && !carrier.walk && carrier.grounded && carrier.reload <= 0) {
          bomb.userId = carrier.id;
          bomb.plantProgress += dt / RULES.plant;
          if (bomb.plantProgress >= 1) {
            Object.assign(bomb, { status: 'planted', carrierId: null, site, seconds: RULES.fuse, plantProgress: 1, userId: null });
            emit('bombPlanted', { actorId: carrier.id, site });
          }
        } else { bomb.plantProgress = 0; bomb.userId = null; }
      }
    } else if (bomb.status === 'dropped') {
      const collector = actors.find(a => a.alive && a.team === 'red' && distXZ(a, bomb) < 1.4 && Math.abs(a.y - bomb.y) < 2);
      if (collector) {
        Object.assign(bomb, { status: 'carried', carrierId: collector.id, plantProgress: 0 });
        emit('bombPickedUp', { actorId: collector.id });
      }
    } else if (bomb.status === 'planted') {
      bomb.seconds = Math.max(0, bomb.seconds - dt);
      const defuser = actors.find(a => a.alive && a.team === 'blue' && a.input.use && !a.walk && a.grounded && distXZ(a, bomb) < 2.4 && Math.abs(a.y - bomb.y) < 2);
      if (defuser) {
        if (bomb.userId !== defuser.id) bomb.defuseProgress = 0;
        bomb.userId = defuser.id;
        bomb.defuseProgress += dt / RULES.defuse;
        if (bomb.defuseProgress >= 1) {
          Object.assign(bomb, { status: 'defused', defuseProgress: 1, userId: null });
          emit('bombDefused', { actorId: defuser.id });
          endRound('blue', 'defused');
        }
      } else { bomb.defuseProgress = 0; bomb.userId = null; }
      if (bomb.seconds <= 0 && bomb.status === 'planted') {
        bomb.status = 'exploded';
        emit('bombExploded', { x: bomb.x, y: bomb.y, z: bomb.z });
        for (const actor of actors) if (actor.alive && distXZ(actor, bomb) < 13) kill(actor);
        endRound('red', 'exploded');
      }
    }
  }

  function step(dt = 1 / TICK_RATE) {
    dt = clamp(finite(dt, 1 / TICK_RATE), 0, 0.05);
    time += dt;
    tick++;
    while (events.length && events[0].time < time - 3) events.shift();
    if (round.phase === 'ended') {
      round.nextIn = Math.max(0, round.nextIn - dt);
      if (round.nextIn <= 0) {
        Object.assign(round, { number: round.number + 1, phase: 'live', seconds: RULES.round, winner: null, reason: null });
        for (const actor of actors) spawn(actor, true);
        assignBomb();
        emit('roundStart', { number: round.number, targetSite: bomb.targetSite });
      }
      return;
    }
    round.seconds = Math.max(0, round.seconds - dt);
    for (const actor of actors) {
      if (!actor.alive) {
        actor.respawnIn = Math.max(0, actor.respawnIn - dt);
        if (actor.respawnIn <= 0) spawn(actor);
        continue;
      }
      actor.cooldown = Math.max(0, actor.cooldown - dt);
      if (actor.reload > 0) {
        actor.reload = Math.max(0, actor.reload - dt);
        if (!actor.reload) actor.ammo = RULES.magazine;
      }
      let controls = actor.bot ? botInput(actor, dt) : time - actor.inputAt > 0.35 ? { ...EMPTY, yaw: actor.yaw, pitch: actor.pitch } : actor.input;
      actor.input = controls;
      actor.yaw = wrapAngle(approachAngle(actor.yaw, controls.yaw ?? actor.yaw, (actor.bot ? 6 : 35) * dt));
      actor.pitch = clamp(finite(controls.pitch, actor.pitch), -1.45, 1.45);
      if ((controls.reload || actor.ammo === 0) && !actor.reload && actor.ammo < RULES.magazine) { actor.reload = RULES.reload; emit('reload', { actorId: actor.id }); }
      const previous = point(actor);
      world.move(actor, controls, dt);
      const moving = controls.forward || controls.back || controls.left || controls.right;
      actor.stuck = moving && distXZ(previous, actor) < PLAYER.speed * dt * 0.15 ? actor.stuck + dt : 0;
      if (controls.fire && round.phase === 'live') shoot(actor);
      if (!Number.isFinite(actor.x + actor.y + actor.z) || actor.y < (world.bounds.minY ?? -12) || Math.abs(actor.x) > 100 || Math.abs(actor.z) > 100) kill(actor);
    }
    updateBomb(dt);
    if (round.seconds <= 0 && bomb.status !== 'planted') endRound('blue', 'time');
  }

  function snapshot() {
    return {
      room: ROOM_ID, tick, time: roundNumber(time), humans: actors.filter(a => !a.bot).length,
      actors: actors.map(a => ({ id: a.id, name: a.name, team: a.team, bot: a.bot, x: roundNumber(a.x), y: roundNumber(a.y), z: roundNumber(a.z), yaw: roundNumber(a.yaw), pitch: roundNumber(a.pitch), hp: a.hp, alive: a.alive, ammo: a.ammo, reload: roundNumber(a.reload), walk: a.walk, grounded: a.grounded, vy: roundNumber(a.vy), respawnIn: roundNumber(a.respawnIn), kills: a.kills, deaths: a.deaths, seq: a.lastSeq, protected: a.protectedUntil > time, carryingBomb: bomb.carrierId === a.id })),
      bomb: Object.fromEntries(Object.entries(bomb).map(([key, value]) => [key, typeof value === 'number' ? roundNumber(value) : value])),
      sites: bombSites, score: { ...score }, round: { ...round, seconds: roundNumber(round.seconds), nextIn: roundNumber(round.nextIn) }, events: [...events],
    };
  }

  return { actors, bomb, round, score, sites: bombSites, world, navigation, join, leave, input, step, snapshot, get time() { return time; }, get tick() { return tick; } };
}
