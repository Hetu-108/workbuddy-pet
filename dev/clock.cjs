'use strict';
/**
 * 冻结归因：rAF 断帧时，主线程还活着吗？
 *  - 断帧期间 setInterval(10) 仍在跑  → 主线程正常，卡在合成/呈现（视频解码、DWM）
 *  - 断帧期间 setInterval(10) 也停了  → 主线程卡死（JS / GC / 同步 IPC）
 *
 *   runtime/electron/electron.exe dev/clock.cjs --secs=40 [--win=small]
 */
const { app, BrowserWindow, screen, ipcMain, powerSaveBlocker } = require('electron');

const ARGV = process.argv.slice(2);
const argOf = (n, d) => {
  const hit = ARGV.find((a) => a === n || a.startsWith(n + '='));
  if (!hit) return d;
  return hit.includes('=') ? hit.split('=')[1] : d;
};
const SECS = Number(argOf('--secs', '40'));
const SMALL = argOf('--win', '') === 'small';
const ROAM = ARGV.includes('--roam');
const PORT = Number(process.env.WB_PET_PORT || 7715);

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const SCRIPT = (secs, roam) => `
(async () => {
  const T0 = performance.now();
  let ticks = 0;
  const tick = setInterval(() => { ticks++; }, 10);
  const p = window.__pets && window.__pets[0];
  if (${roam} && p) {
    p.cfg.roamEnabled = true;
    var rt = setInterval(() => { if (p.roamRaf === null && !p.dragging) p.roam(); }, 900);
  }
  const gaps = [];
  let last = performance.now();
  let lastTicks = ticks;
  let frames = 0;
  await new Promise((res) => {
    const step = (t) => {
      const dt = t - last;
      if (dt > 40) {
        gaps.push({ at: Math.round(t - T0), ms: Math.round(dt), ticksDuring: ticks - lastTicks, vis: document.visibilityState, anim: p ? p.anim : '?' });
      }
      last = t; lastTicks = ticks; frames++;
      if (t - T0 < ${secs * 1000}) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
  clearInterval(tick); if (${roam}) clearInterval(rt);
  return { frames, fps: +(frames / ${secs}).toFixed(1), gaps };
})()`;

app.whenReady().then(async () => {
  powerSaveBlocker.start('prevent-display-sleep');
  const wa = screen.getPrimaryDisplay().workArea;
  const bounds = SMALL
    ? { x: Math.round(wa.x + wa.width - 700), y: Math.round(wa.y + wa.height - 460), width: 640, height: 400 }
    : { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
  const win = new BrowserWindow({
    ...bounds, transparent: true, frame: false, hasShadow: false, resizable: false,
    skipTaskbar: true, show: false, backgroundColor: '#00000000',
    webPreferences: {
      preload: require('node:path').join(__dirname, '..', 'desktop', 'preload.cjs'),
      backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.once('ready-to-show', () => win.showInactive());
  try { await win.loadURL(`http://127.0.0.1:${PORT}/?desktop=1`); }
  catch (e) { console.log('LOAD_FAIL ' + e.message); app.quit(); return; }
  await new Promise((r) => setTimeout(r, 3500));
  const r = await win.webContents.executeJavaScript(SCRIPT(SECS, ROAM)).catch((e) => ({ err: String(e) }));
  console.log('RESULT ' + JSON.stringify(r));
  app.quit();
});
