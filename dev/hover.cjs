'use strict';
/**
 * 悬停路径专项：鼠标在屏幕上高频划过（并且反复扫过鱼身）时，掉不掉帧。
 * 现状的做法是「整窗穿透 + forward:true」，意味着屏幕任何一次鼠标移动都会送进渲染进程。
 *
 *   runtime/electron/electron.exe dev/hover.cjs [--win=small]
 */
const { app, BrowserWindow, screen, ipcMain } = require('electron');

const ARGV = process.argv.slice(2);
const argOf = (n, d) => {
  const hit = ARGV.find((a) => a === n || a.startsWith(n + '='));
  if (!hit) return d;
  return hit.includes('=') ? hit.split('=')[1] : d;
};
const SMALL = argOf('--win', '') === 'small';
const PORT = Number(process.env.WB_PET_PORT || 7715);

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const PERF = (ms) => `
window.__perf = (ms) => new Promise((resolve) => {
  const deltas = []; const long = [];
  const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push(Math.round(e.duration)); });
  try { po.observe({ entryTypes: ['longtask'] }); } catch {}
  let last = performance.now(); const t0 = last;
  const step = (t) => {
    deltas.push(t - last); last = t;
    if (t - t0 < ms) requestAnimationFrame(step);
    else {
      try { po.disconnect(); } catch {}
      const d = deltas.slice(3).sort((a, b) => a - b);
      const q = (p) => (d.length ? +d[Math.min(d.length - 1, Math.floor(d.length * p))].toFixed(1) : 0);
      resolve({ frames: d.length, p50: q(0.5), p95: q(0.95), max: +Math.max(...d, 0).toFixed(1),
        over32: d.filter((x) => x > 32).length, longtasks: long });
    }
  };
  requestAnimationFrame(step);
});
true;`;

let wantMoves = 0;
let gotMoves = 0;

app.whenReady().then(async () => {
  const wa = screen.getPrimaryDisplay().workArea;
  const bounds = SMALL
    ? { x: Math.round(wa.x + wa.width - 700), y: Math.round(wa.y + wa.height - 460), width: 640, height: 400 }
    : { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
  const win = new BrowserWindow({
    ...bounds,
    transparent: true, frame: false, hasShadow: false, resizable: false,
    skipTaskbar: true, show: false, backgroundColor: '#00000000',
    webPreferences: {
      preload: require('node:path').join(__dirname, '..', 'desktop', 'preload.cjs'),
      backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });

  // 统计接管开关的翻转次数（每次翻转都会动一次窗口输入属性）
  let toggles = 0;
  ipcMain.on('wb:interactive', () => { toggles++; });

  win.once('ready-to-show', () => win.showInactive());
  try { await win.loadURL(`http://127.0.0.1:${PORT}/?desktop=1`); }
  catch (e) { console.log('LOAD_FAIL ' + e.message); app.quit(); return; }
  await new Promise((r) => setTimeout(r, 3500));
  const js = (c) => win.webContents.executeJavaScript(c).catch(() => null);
  await js(PERF(0));

  // 页面里数一下 mousemove 的到达量
  await js(`
    window.__mm = 0;
    window.addEventListener('mousemove', () => { window.__mm++; }, { passive: true });
    const p = window.__pets[0]; p.cfg.roamEnabled = true;
    window.__rt = setInterval(() => { if (p.roamRaf === null && !p.dragging) p.roam(); }, 900);
    true;
  `);

  console.log('[A 静置 8s  ]', JSON.stringify(await js('window.__perf(8000)')), 'toggles=' + toggles);

  // 高频扫过：横穿整屏，路径经过鱼身
  const t0 = Date.now();
  const timer = setInterval(() => {
    const p = screen.getPrimaryDisplay().workArea;
    const x = p.x + 200 + ((Date.now() - t0) / 6) % (p.width - 400);
    const y = p.y + p.height * 0.62 + Math.sin((Date.now() - t0) / 120) * 90;
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
    wantMoves++;
  }, 4); // ~250Hz，模拟高回报率鼠标
  console.log('[B 划鼠标 8s]', JSON.stringify(await js('window.__perf(8000)')), 'toggles=' + toggles);
  clearInterval(timer);
  const mm = await js('window.__mm');
  console.log('[moves] 发出', wantMoves, '渲染进程收到', mm);

  app.quit();
});
