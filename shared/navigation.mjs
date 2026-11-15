/** Small graph fallback. Production uses the Recast adapter passed to createGame. */
export function graphNavigation(data) {
  const nodes = data?.nodes || [];
  const nearestIndex = point => {
    let distance = Infinity;
    let index = -1;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const candidate = (node.x - point.x) ** 2 + (node.y - point.y) ** 2 * 4 + (node.z - point.z) ** 2;
      if (candidate < distance) { distance = candidate; index = i; }
    }
    return index;
  };
  const copy = node => ({ x: node.x, y: node.y, z: node.z });
  return {
    spawns: data?.spawns,
    sites: data?.sites,
    nearestPoint(point) { const index = nearestIndex(point); return index < 0 ? null : copy(nodes[index]); },
    findPath(start, end) {
      const from = nearestIndex(start), to = nearestIndex(end);
      if (from < 0 || to < 0) return [];
      const distances = new Map([[from, 0]]), parents = new Map(), queue = new Set([from]);
      let examined = 0;
      while (queue.size && examined++ < 12000) {
        let current = -1, best = Infinity;
        for (const index of queue) {
          const node = nodes[index], goal = nodes[to];
          const estimate = distances.get(index) + Math.hypot(node.x - goal.x, node.y - goal.y, node.z - goal.z);
          if (estimate < best) { best = estimate; current = index; }
        }
        if (current === to) {
          const path = [copy(nodes[to])];
          while (parents.has(current)) { current = parents.get(current); path.push(copy(nodes[current])); }
          return path.reverse();
        }
        queue.delete(current);
        for (const next of nodes[current].neighbors || []) {
          if (!nodes[next]) continue;
          const n = nodes[next], c = nodes[current];
          const distance = distances.get(current) + Math.hypot(n.x - c.x, n.y - c.y, n.z - c.z);
          if (distance < (distances.get(next) ?? Infinity)) { distances.set(next, distance); parents.set(next, current); queue.add(next); }
        }
      }
      return [];
    },
  };
}
