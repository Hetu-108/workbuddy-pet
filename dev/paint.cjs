'use strict';
// 数一数"每秒真正提交了几帧位置"：改造前 = 每个 rAF 都提交（165 次/秒），改造后应 ≈ 45。
const { app, BrowserWindow, screen } = require('electron');
const ARGV = process.argv.slice(2);
const SECS = Number((ARGV.find((a) => a.startsWith('--secs=')) || '--secs=20').split('=')[1]);
const PORT = Number(process.env.WB_PET_PORT || 7715);
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const SCRIPT = (secs) => `
(async () => {
  const p = window.__pets[0];
  const root = p.root;
  let writes = 0, calls = 0, lastTf = root.style.transform;
  const orig = Object.getPrototypeOf(p)._applyPos;
  Object.getPrototypeOf(p)._applyPos = function (force) {
    calls++;
    const r = orig.call(this, force);
    const tf = root.style.transform;
    if (tf !== lastTf) { writes++; lastTf = tf; }
    return r;
  };
  const t0 = performance.now();
  let frames = 0, last = t0;
  p.cfg.roamEnabled = true;
  const rt = setInterval(() => { if (p.roamRaf === null && !p.dragging) p.roam(); }, 700);
  await new Promise((res) => {
    const step = (t) => { frames++; if (t - t0 < ${secs} * 1000) requestAnimationFrame(step); else res(); };
    requestAnimationFrame(step);
  });
  clearInterval(rt);
  const secs = (performance.now() - t0) / 1000;
  return {
    secs: +secs.toFixed(1),
    pageFps: +(frames / secs).toFixed(1),
    applyCallsPerSec: +(calls / secs).toFixed(1),
    commitPerSec: +(writes / secs).toFixed(1),
  };
})()`;

app.whenReady().then(async () => {
  const wa = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    x: wa.x, y: wa.y, width: wa.width, height: wa.height,
    transparent: true, frame: false, hasShadow: false, resizable: false,
    skipTaskbar: true, show: false, backgroundColor: '#00000000',
    webPreferences: { backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.once('ready-to-show', () => win.showInactive());
  try { await win.loadURL(`http://127.0.0.1:${PORT}/?desktop=1`); }
  catch (e) { console.log('LOAD_FAIL ' + e.message); app.quit(); return; }
  await new Promise((r) => setTimeout(r, 3500));
  const r = await win.webContents.executeJavaScript(SCRIPT(SECS)).catch((e) => ({ err: String(e) }));
  console.log('PAINT ' + JSON.stringify(r));
  app.quit();
});
