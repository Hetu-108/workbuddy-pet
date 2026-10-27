// wb-pet 本地桥：零依赖 HTTP 服务。
//  静态站点（桌宠页面 + webm 素材）+ 事件通道（SSE）+ 控制接口（state / say / anim）。
//  只监听 127.0.0.1，不对外。
//
// 启动：node server.mjs [--port 7715] [--open]

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '1.0.0';

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const PORT = Number(argOf('--port', process.env.WB_PET_PORT || 7715));
const OPEN = argv.includes('--open');

// 「大脑」地址：洛书仓库里的 pet_bridge.py。写在服务端而不是页面里，
// 好处是页面只跟同源的 /api/chat 打交道，不用碰 CORS，也不用把地址散在前端。
const BRAIN = (process.env.WB_PET_BRAIN || 'http://127.0.0.1:8765').replace(/\/+$/, '');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

/** 当前状态（供 GET /api/state 与新连接的客户端补齐） */
const state = { state: null, ts: 0 };
/** SSE 客户端 */
const clients = new Set();

function broadcast(msg) {
  const payload = 'data: ' + JSON.stringify(msg) + '\n\n';
  for (const res of clients) {
    try { res.write(payload); } catch { clients.delete(res); }
  }
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(buf));
    req.on('error', () => resolve(''));
  });
}

// ---- 大脑代理（零依赖，只用 node:http） ----
// 与洛书那边的 pet_bridge.py 通话；它没起的时候不要卡住页面，直接快速失败。
function brainRequest(pathname, payload, timeout = 130000) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(BRAIN + pathname); } catch { return reject(new Error('大脑地址不合法：' + BRAIN)); }
    const data = payload === undefined ? null : JSON.stringify(payload);
    const req = http.request({
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname + u.search,
      method: data ? 'POST' : 'GET',
      headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {},
    }, (rs) => {
      let buf = '';
      rs.setEncoding('utf8');
      rs.on('data', (c) => { buf += c; });
      rs.on('end', () => {
        let body;
        try { body = JSON.parse(buf); } catch { body = { ok: false, error: (buf || '空响应').slice(0, 300) }; }
        resolve({ status: rs.statusCode || 200, body });
      });
    });
    req.on('error', (e) => reject(e));
    req.setTimeout(timeout, () => req.destroy(new Error('大脑响应超时')));
    if (data) req.write(data);
    req.end();
  });
}

async function listMemes() {  try {
    const files = await fsp.readdir(path.join(ROOT, 'assets', 'memes'));
    return files.filter((f) => f.toLowerCase().endsWith('.png')).map((f) => f.slice(0, -4));
  } catch {
    return [];
  }
}

async function serveStatic(req, res, pathname) {
  const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const file = path.join(ROOT, rel);
  // 防目录穿越
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) throw new Error('not a file');
    const ext = path.extname(file).toLowerCase();
    const isVideo = ext === '.webm';
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': stat.size,
      // 动画素材可长缓存；配置与脚本不缓存，改完刷新即生效
      'cache-control': isVideo ? 'public, max-age=86400' : 'no-cache',
      'access-control-allow-origin': '*',
    });
    fs.createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;

  // ---- 静态 ----
  if (req.method === 'GET' && !p.startsWith('/api/')) {
    return serveStatic(req, res, p);
  }

  // ---- API ----
  if (p === '/api/info') {
    return json(res, 200, { version: VERSION, memes: await listMemes(), port: PORT });
  }

  if (p === '/api/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    res.write(': connected\n\n');
    if (state.state) res.write('data: ' + JSON.stringify({ type: 'state', state: state.state }) + '\n\n');
    clients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* noop */ } }, 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  if (p === '/api/state' && req.method === 'GET') {
    return json(res, 200, state);
  }

  // 大脑探活：桌宠页面可以用它判断「要不要显示聊天入口」
  if (p === '/api/chat/health') {
    try {
      const r = await brainRequest('/health');
      return json(res, 200, { ok: r.status === 200, brain: BRAIN, ...r.body });
    } catch (e) {
      return json(res, 200, { ok: false, brain: BRAIN, error: String((e && e.message) || e) });
    }
  }

  if (req.method === 'POST') {
    const raw = await readBody(req);
    let body = {};
    if (raw) {
      try { body = JSON.parse(raw); } catch { body = { text: raw }; }
    }
    // 同时支持 query 参数：/api/state?state=working
    for (const [k, v] of url.searchParams) if (!(k in body)) body[k] = v;

    switch (p) {
      case '/api/state': {
        const s = String(body.state || '').trim();
        if (!s) return json(res, 400, { ok: false, error: 'state required' });
        state.state = s;
        state.ts = Date.now();
        broadcast({ type: 'state', state: s });
        return json(res, 200, { ok: true, state: s });
      }
      case '/api/say': {
        const text = String(body.text || '');
        if (!text && !body.image) return json(res, 400, { ok: false, error: 'text required' });
        broadcast({
          type: 'say',
          pet: body.pet,
          text,
          image: body.image ? String(body.image).replace(/\.png$/i, '') : undefined,
          ms: body.ms ? Number(body.ms) : undefined,
        });
        return json(res, 200, { ok: true });
      }
      case '/api/anim': {
        const name = String(body.name || body.anim || '').trim();
        if (!name) return json(res, 400, { ok: false, error: 'name required' });
        const pool = body.move ? 'move' : 'anim';
        broadcast({ type: pool, name, pet: body.pet });
        return json(res, 200, { ok: true, name });
      }
      case '/api/whisper':
        broadcast({ type: 'whisper', pet: body.pet });
        return json(res, 200, { ok: true });
      case '/api/roam':
        broadcast({ type: 'roam', pet: body.pet });
        return json(res, 200, { ok: true });
      case '/api/home':
        broadcast({ type: 'home', pet: body.pet });
        return json(res, 200, { ok: true });
      case '/api/log':
        console.log('[wb-pet][client] ' + String(body.text || '').slice(0, 800));
        return json(res, 200, { ok: true });
      case '/api/chat':
      case '/api/chat/nudge': {
        const text = String(body.text || '');
        try {
          // 只有 /chat 需要台词，/nudge 由大脑自己造一句
          const r = await brainRequest(p === '/api/chat' ? '/chat' : '/nudge',
            p === '/api/chat' ? { text } : { idle: Number(body.idle) || 0 });
          return json(res, r.status, r.body);
        } catch (e) {
          const msg = String((e && e.message) || e);
          const hint = /ECONNREFUSED|ENOTFOUND|connect/i.test(msg)
            ? `连不上大脑 ${BRAIN}：先在洛书仓库里跑 python pet_bridge.py`
            : msg;
          console.log('[wb-pet] chat 失败：' + hint);
          return json(res, 502, { ok: false, error: hint });
        }
      }
      case '/api/refresh':
        broadcast({ type: 'refresh' });
        return json(res, 200, { ok: true });
      default:
        return json(res, 404, { ok: false, error: 'unknown endpoint' });
    }
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    }).end();
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404');
});

server.listen(PORT, '127.0.0.1', () => {
  const urlStr = `http://127.0.0.1:${PORT}/`;
  console.log(`[wb-pet] 大肥鱼已就位：${urlStr}`);
  console.log(`[wb-pet] 大脑：${BRAIN}（没起也不影响它自己玩）`);
  console.log('[wb-pet] 控制示例：');
  console.log(`  curl -X POST ${urlStr}api/state -H "content-type: application/json" -d "{\\"state\\":\\"working\\"}"`);
  console.log(`  curl -X POST ${urlStr}api/say   -H "content-type: application/json" -d "{\\"text\\":\\"我在呢\\"}"`);
  if (OPEN) {
    const cmd = process.platform === 'win32' ? `start "" "${urlStr}?bg=1"` : `open "${urlStr}?bg=1"`;
    exec(cmd, () => {});
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[wb-pet] 端口 ${PORT} 被占用，换一个：node server.mjs --port 7716`);
    process.exit(1);
  }
  throw e;
});
