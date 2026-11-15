import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { WebSocket, WebSocketServer } from 'ws';
import { CollisionWorld } from '../shared/world.mjs';
import { createGame, cleanName, ROOM_ID, RULES, TICK_RATE } from '../shared/game.mjs';
import { graphNavigation } from '../shared/navigation.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const MIME = Object.freeze({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2' });
const isLocal = address => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
const within = (base, target) => target === base || target.startsWith(base + path.sep);

function json(res, code, body) {
  const buffer = Buffer.from(JSON.stringify(body));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buffer.length, 'Cache-Control': 'no-store' });
  res.end(buffer);
}

async function exists(filename) { try { await stat(filename); return true; } catch { return false; } }

export async function loadGameAssets(root = ROOT) {
  let world = null, navigation = null;
  const collisionFile = path.join(root, 'public/assets/maps/sandstone-collision.bin');
  if (await exists(collisionFile)) {
    const data = await readFile(collisionFile);
    if (data.length % 36 !== 0 || data.length > 200 * 1024 * 1024) throw new Error('Invalid collision asset size.');
    // Copy to aligned owned memory; a Buffer byteOffset need not be float-aligned.
    world = new CollisionWorld(new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
  }
  const adapterFile = path.join(root, 'server/nav-runtime.mjs');
  if (await exists(adapterFile)) {
    try { navigation = await (await import(pathToFileURL(adapterFile).href)).loadNavigation(); }
    catch (error) { console.error('Navigation is unavailable:', error.message); }
  }
  if (!navigation) {
    const graphFile = path.join(root, 'public/assets/maps/sandstone-navigation.json');
    if (await exists(graphFile)) navigation = graphNavigation(JSON.parse(await readFile(graphFile, 'utf8')));
  }
  return { world, navigation };
}

function allowedOrigin(req, configuredOrigin) {
  const raw = req.headers.origin;
  if (!raw) return true; // Non-browser health/test clients have no Origin header.
  let origin;
  try { origin = new URL(raw); } catch { return false; }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.pathname !== '/' || origin.username || origin.password) return false;
  if (origin.host === req.headers.host) return true;
  if (origin.origin === 'https://contra-3d.onrender.com') return true;
  if (configuredOrigin && origin.origin === configuredOrigin) return true;
  return ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) && isLocal(req.socket.remoteAddress);
}

async function capture(req, res, root) {
  if (process.env.NODE_ENV === 'production' || !isLocal(req.socket.remoteAddress)) return json(res, 404, { error: 'Not found' });
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) { json(res, 413, { error: 'Capture too large' }); return; }
    chunks.push(chunk);
  }
  let buffer = Buffer.concat(chunks);
  if ((req.headers['content-type'] || '').includes('application/json')) {
    let data;
    try { data = JSON.parse(buffer.toString('utf8')); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    if (typeof data.image !== 'string' || !data.image.startsWith('data:image/png;base64,')) return json(res, 400, { error: 'PNG image required' });
    buffer = Buffer.from(data.image.slice(22), 'base64');
  }
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return json(res, 400, { error: 'PNG image required' });
  const directory = path.join(root, 'art/browser-previews');
  await mkdir(directory, { recursive: true });
  const filename = `contra-${Date.now()}.png`;
  await writeFile(path.join(directory, filename), buffer);
  json(res, 201, { ok: true, filename });
}

/** One process, one ten-player room. Both HTTP and WebSocket share the Render port. */
export async function createContraServer(options = {}) {
  const root = path.resolve(options.root || ROOT);
  const publicDir = path.resolve(options.publicDir || path.join(root, 'public'));
  const assets = options.game ? { world: options.game.world, navigation: options.game.navigation } : options.world ? { world: options.world, navigation: options.navigation || null } : await loadGameAssets(root);
  const ready = !!(assets.world && assets.navigation);
  // A missing map keeps /health available with ready:false, without inventing a replacement arena.
  const game = options.game || (assets.world ? createGame({ world: assets.world, navigation: assets.navigation }) : null);
  const clients = new Map();
  let interval = null, heartbeat = null, lastClock = performance.now(), accumulated = 0;
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    try {
      const parsed = new URL(req.url, 'http://localhost');
      if (parsed.pathname === '/health') return json(res, 200, { ok: true, ready, room: ROOM_ID, humans: clients.size });
      if (parsed.pathname === '/api/room' && req.method === 'GET') return json(res, 200, { room: ROOM_ID, capacity: RULES.teamSize * 2, humans: clients.size, bots: game ? 10 - clients.size : 0, ready, tickRate: TICK_RATE, snapshotRate: 15, round: game?.snapshot().round || null });
      if (parsed.pathname === '/api/capture' && req.method === 'POST') return await capture(req, res, root);
      if (parsed.pathname === '/api/benchmark' && req.method === 'POST' && process.env.NODE_ENV !== 'production' && isLocal(req.socket.remoteAddress)) {
        let body='';for await(const chunk of req){body+=chunk;if(body.length>50000)return json(res,413,{error:'Too large'});}
        const data=JSON.parse(body);await mkdir(path.join(root,'art/benchmarks'),{recursive:true});
        await writeFile(path.join(root,'art/benchmarks',`gameplay-${Date.now()}.json`),JSON.stringify(data,null,2));return json(res,201,{ok:true});
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
      let pathname;
      try { pathname = decodeURIComponent(parsed.pathname); } catch { return json(res, 400, { error: 'Invalid path' }); }
      if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').some(part => part === '..' || part.startsWith('.'))) return json(res, 403, { error: 'Forbidden' });
      let base = publicDir, relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (pathname.startsWith('/shared/')) { base = path.join(root, 'shared'); relative = pathname.slice(8); }
      if (pathname.startsWith('/vendor/three/')) { base = path.join(root, 'node_modules/three'); relative = pathname.slice(14); }
      if (pathname.startsWith('/vendor/recast/')) { base = path.join(root, 'node_modules/@recast-navigation'); relative = pathname.slice(15); }
      const filename = path.resolve(base, relative);
      if (!within(base, filename)) return json(res, 403, { error: 'Forbidden' });
      let metadata;
      try { metadata = await stat(filename); } catch { return json(res, 404, { error: 'Not found' }); }
      if (!metadata.isFile()) return json(res, 404, { error: 'Not found' });
      const extension = path.extname(filename).toLowerCase();
      if (base !== publicDir && !['.js', '.mjs', '.wasm', '.bin'].includes(extension)) return json(res, 403, { error: 'Forbidden' });
      const headers = { 'Content-Type': MIME[extension] || 'application/octet-stream', 'Content-Length': metadata.size, 'Cache-Control': ['.html', '.js', '.mjs', '.css', '.json'].includes(extension) ? 'no-cache' : 'public, max-age=86400' };
      res.writeHead(200, headers);
      if (req.method === 'HEAD') return res.end();
      const stream = createReadStream(filename);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    } catch (error) {
      console.error('HTTP request failed:', error.message);
      if (!res.headersSent) json(res, 500, { error: 'Request failed' }); else res.end();
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false, clientTracking: true });
  server.on('upgrade', (req, socket, head) => {
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { socket.destroy(); return; }
    if (pathname !== '/ws' || !allowedOrigin(req, options.publicOrigin || process.env.PUBLIC_ORIGIN)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    if (!game || clients.size >= 10) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  const send = (ws, message) => { if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 256 * 1024) ws.send(JSON.stringify(message)); };
  wss.on('connection', (ws, req) => {
    const actor = game.join('PLAYER');
    if (!actor) { ws.close(1013, 'Room full'); return; }
    const record = { id: actor.id, alive: true, tokens: 90, lastMessage: performance.now(), violations: 0 };
    clients.set(ws, record);
    send(ws, { type: 'welcome', id: actor.id, room: ROOM_ID, team: actor.team, tickRate: TICK_RATE, snapshotRate: 15, rules: RULES });
    send(ws, { type: 'state', ...game.snapshot() });
    ws.on('pong', () => { record.alive = true; });
    ws.on('message', (data, binary) => {
      const now = performance.now();
      record.tokens = Math.min(90, record.tokens + (now - record.lastMessage) * 0.06);
      record.lastMessage = now;
      if (--record.tokens < 0) { if (++record.violations > 8) ws.close(1008, 'Message rate exceeded'); return; }
      if (binary) { ws.close(1003, 'JSON messages required'); return; }
      let message;
      try { message = JSON.parse(data.toString()); } catch { if (++record.violations > 4) ws.close(1008, 'Invalid JSON'); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) return;
      if (message.type === 'input') game.input(record.id, message);
      else if (message.type === 'join' || message.type === 'name') actor.name = cleanName(message.name);
      else if (message.type === 'ping') send(ws, { type: 'pong', at: typeof message.at === 'number' && Number.isFinite(message.at) ? message.at : 0, time: game.time });
    });
    ws.on('close', () => { clients.delete(ws); game.leave(record.id); });
    ws.on('error', () => { /* Close is responsible for freeing the room slot. */ });
  });
  function update() {
    if (!game) return;
    const now = performance.now();
    accumulated += Math.min((now - lastClock) / 1000, 0.1);
    lastClock = now;
    const dt = 1 / TICK_RATE;
    let steps = 0;
    while (accumulated >= dt && steps++ < 3) {
      game.step(dt);
      accumulated -= dt;
      if (game.tick % 2 === 0 && clients.size) {
        const state = JSON.stringify({ type: 'state', ...game.snapshot() });
        for (const ws of clients.keys()) {
          if (ws.readyState !== WebSocket.OPEN) continue;
          if (ws.bufferedAmount > 512 * 1024) { ws.close(1008, 'Connection too slow'); continue; }
          ws.send(state);
        }
      }
    }
  }
  return {
    server, wss, game, ready, clients,
    async start({ port = options.port ?? Number(process.env.PORT || 8766), host = options.host || process.env.HOST || '0.0.0.0' } = {}) {
      if (server.listening) return server.address();
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(); }); });
      lastClock = performance.now();
      interval = setInterval(update, 1000 / TICK_RATE);
      interval.unref();
      heartbeat = setInterval(() => {
        for (const [ws, record] of clients) {
          if (!record.alive) { ws.terminate(); continue; }
          record.alive = false;
          ws.ping();
        }
      }, 15000);
      heartbeat.unref();
      return server.address();
    },
    async close() {
      clearInterval(interval);
      clearInterval(heartbeat);
      for (const ws of clients.keys()) ws.terminate();
      await new Promise(resolve => wss.close(resolve));
      if (server.listening) await new Promise(resolve => server.close(resolve));
    },
  };
}
