'use strict';
/**
 * 视频解码质量：鱼的动作看起来"卡"，到底是页面掉帧，还是 webm 本身丢帧了？
 * rAF 只有 6ms 说明主线程很闲，但如果 compositor 忙，视频帧会被丢掉。
 *
 *   runtime/electron/electron.exe dev/vidq.cjs [--secs=20] [--mode=roam|idle]
 */
const { app, BrowserWindow, screen } = require('electron');

const ARGV = process.argv.slice(2);
const argOf = (n, d) => {
  const hit = ARGV.find((a) => a === n || a.startsWith(n + '='));
  if (!hit) return d;
  return hit.includes('=') ? hit.split('=')[1] : d;
};
const SECS = Number(argOf('--secs', '20'));
const MODE = argOf('--mode', 'roam');
const PORT = Number(process.env.WB_PET_PORT || 7715);

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const SCRIPT = (mode, secs) => `
(async () => {
  const p = window.__pets[0];
  const front = () => (p.frontIsA ? p.videos[0] : p.videos[1]);
  const q0 = front().getVideoPlaybackQuality ? front().getVideoPlaybackQuality() : null;

  // 逐帧到达间隔（rVFC：视频真实呈现的每一帧）
  const gaps = [];
  let lastT = 0, rvfcOk = false;
  const onFrame = (now, meta) => {
    if (lastT) gaps.push(now - lastT);
    lastT = now;
    if (front().requestVideoFrameCallback) front().requestVideoFrameCallback(onFrame);
  };
  if (front().requestVideoFrameCallback) { rvfcOk = true; front().requestVideoFrameCallback(onFrame); }

  const t0 = performance.now();
  let frames = 0, slow = 0, last = t0;
  if (${mode === 'roam'}) {
    p.cfg.roamEnabled = true;
    var rt = setInterval(() => { if (p.roamRaf === null && !p.dragging) p.roam(); }, 700);
  }
  await new Promise((res) => {
    const step = (t) => {
      const dt = t - last; last = t; frames++;
      if (dt > 40) slow++;
      if (t - t0 < ${secs * 1000}) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
  if (${mode === 'roam'}) clearInterval(rt);

  const q1 = front().getVideoPlaybackQuality ? front().getVideoPlaybackQuality() : null;
  const g = gaps.slice(1).sort((a, b) => a - b);
  const q = (x) => (g.length ? +g[Math.min(g.length - 1, Math.floor(g.length * x))].toFixed(1) : 0);
  return {
    rvfc: rvfcOk,
    pageFps: +(frames / ${secs}).toFixed(1), pageSlow: slow,
    video: q0 && q1 ? {
      total: q1.totalVideoFrames - q0.totalVideoFrames,
      dropped: q1.droppedVideoFrames - q0.droppedVideoFrames,
      degraded: q1.corruptedVideoFrames - q0.corruptedVideoFrames,
    } : null,
    frameGaps: { n: g.length, p50: q(0.5), p90: q(0.9), max: g.length ? +g[g.length - 1].toFixed(1) : 0,
      over50: g.filter((x) => x > 50).length, over100: g.filter((x) => x > 100).length },
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
  const r = await win.webContents.executeJavaScript(SCRIPT(MODE, SECS)).catch((e) => ({ err: String(e) }));
  console.log('VIDQ ' + JSON.stringify(r));
  app.quit();
});
