'use strict';
/**
 * 掉帧归因：60s 自然行为（漫游 + 偶发点击 + 气泡），把每一次 >24ms 的卡顿
 * 和它之前 400ms 内发生的事（换动画 / 视频 play / 气泡 / 位置更新）对起来看。
 *
 *   runtime/electron/electron.exe dev/diag.cjs --secs=60 [--win=small]
 */
const { app, BrowserWindow, screen } = require('electron');

const ARGV = process.argv.slice(2);
const argOf = (n, d) => {
  const hit = ARGV.find((a) => a === n || a.startsWith(n + '='));
  if (!hit) return d;
  return hit.includes('=') ? hit.split('=')[1] : d;
};
const SECS = Number(argOf('--secs', '45'));
const SMALL = argOf('--win', '') === 'small';
const PORT = Number(process.env.WB_PET_PORT || 7715);

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const SCRIPT = (secs) => `
(async () => {
  const p = window.__pets[0];
  const T0 = performance.now();
  const ev = [];
  const mark = (n, extra) => {
    ev.push({ t: performance.now(), n, extra });
    if (ev.length > 400) ev.shift();
  };

  // ---- 埋点：所有可能引发卡顿的动作 ----
  const P = Object.getPrototypeOf(p);
  for (const name of ['switchTo', 'roam', 'say', 'hideBubble', '_recover', '_startSquash']) {
    const orig = P[name];
    if (typeof orig !== 'function') continue;
    P[name] = function (...a) {
      const r = orig.apply(this, a);
      mark(name, typeof a[0] === 'string' ? a[0] : '');
      return r;
    };
  }
  const origPlay = HTMLMediaElement.prototype.play;
  let playCount = 0;
  HTMLMediaElement.prototype.play = function () { playCount++; mark('video.play', this.dataset.anim || ''); return origPlay.apply(this, arguments); };
  const origPause = HTMLMediaElement.prototype.pause;
  HTMLElement.prototype.__proto__; // noop
  // 视频事件（首帧解码完成 / 卡住等）
  document.addEventListener('playing', (e) => { if (e.target.tagName === 'VIDEO') mark('video.playing', e.target.dataset.anim || ''); }, true);
  document.addEventListener('waiting', (e) => { if (e.target.tagName === 'VIDEO') mark('video.waiting', e.target.dataset.anim || ''); }, true);
  document.addEventListener('stalled', (e) => { if (e.target.tagName === 'VIDEO') mark('video.stalled', e.target.dataset.anim || ''); }, true);

  // ---- 帧间隔采样 ----
  const slow = [];
  let last = performance.now();
  let frames = 0;
  const long = [];
  const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push({ at: Math.round(e.startTime - T0), ms: Math.round(e.duration) }); });
  try { po.observe({ entryTypes: ['longtask'] }); } catch {}

  // ---- 自然行为：漫游 + 偶尔点一下 ----
  p.cfg.roamEnabled = true;
  const roamT = setInterval(() => { if (p.roamRaf === null && !p.dragging) p.roam(); }, 900);
  const clickT = setInterval(() => { p.onClick && p.onClick(); }, 4000);

  await new Promise((res) => {
    const step = (t) => {
      const dt = t - last; last = t; frames++;
      if (dt > 24) {
        const near = ev.filter((e) => e.t <= t + 2 && e.t >= t - 600).map((e) => e.n + (e.extra ? '(' + e.extra + ')' : '') + '@' + Math.round(e.t - t) + 'ms');
        slow.push({ at: Math.round(t - T0), ms: Math.round(dt), anim: p.anim, prev: near.slice(-8) });
      }
      if (t - T0 < ${secs * 1000}) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });

  clearInterval(roamT); clearInterval(clickT);
  try { po.disconnect(); } catch {}
  P.switchTo = Object.getPrototypeOf(p).switchTo; // 不还原也行，进程即将退出
  HTMLMediaElement.prototype.play = origPlay;

  const ms = slow.map((s) => s.ms).sort((a, b) => a - b);
  return {
    frames,
    fps: +(frames / (${secs})).toFixed(1),
    slowCount: slow.length,
    slowMs: { p50: ms[Math.floor(ms.length / 2)] || 0, max: ms[ms.length - 1] || 0 },
    videoPlays: playCount,
    longtasks: long,
    slow: slow.slice(0, 25),
  };
})()`;

app.whenReady().then(async () => {
  const wa = screen.getPrimaryDisplay().workArea;
  const bounds = SMALL
    ? { x: Math.round(wa.x + wa.width - 700), y: Math.round(wa.y + wa.height - 460), width: 640, height: 400 }
    : { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
  const win = new BrowserWindow({
    ...bounds,
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
  console.log('RESULT ' + JSON.stringify(r));
  app.quit();
});
