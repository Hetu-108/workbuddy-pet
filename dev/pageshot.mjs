// 用 DevTools 协议截「窗口自己」的画面（不受桌面合成影响）
import fs from 'node:fs';

const PORT = process.env.CDP_PORT || 9222;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id;
  pending.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
});
ws.addEventListener('open', async () => {
  try {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const out = process.argv[2] || 'page.png';
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    console.log('saved', out);
  } catch (e) {
    console.error('ERR', e.message);
  } finally {
    ws.close();
    process.exit(0);
  }
});
