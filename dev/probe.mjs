// 一次性探针：连上常驻桌宠的 DevTools 协议，读页面内的真实状态。
// 用法：node probe.mjs [表达式]
const PORT = process.env.CDP_PORT || 9222;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.error('没有找到页面');
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();

function send(method, params = {}) {
  const mid = ++id;
  return new Promise((resolve, reject) => {
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});

const EXPR = process.argv[2] || `JSON.stringify({
  pets: (window.__pets || []).length,
  roots: document.querySelectorAll('.pet-root').length,
  videos: [...document.querySelectorAll('video')].map((v) => {
    const r = v.getBoundingClientRect();
    return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), op: getComputedStyle(v).opacity, src: (v.currentSrc || '').split('/').pop() };
  }),
  windows: { iw: innerWidth, ih: innerHeight },
  pos: (window.__pets || []).map((p) => ({ x: Math.round(p.pos.x), y: Math.round(p.pos.y), size: p.size })),
})`;

ws.addEventListener('open', async () => {
  try {
    const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true, awaitPromise: true });
    console.log(typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value, null, 1));
  } catch (e) {
    console.error('ERR', e.message);
  } finally {
    ws.close();
    process.exit(0);
  }
});
