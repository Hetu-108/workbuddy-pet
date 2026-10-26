'use strict';
/**
 * 基准：漫游 20 秒里，GPU 进程 / 渲染进程到底吃掉多少 CPU，帧间隔如何。
 * 用来对比"每帧都提交"和"限制提交帧率"两种做法的差别。
 *
 *   runtime/electron/electron.exe dev/bench.cjs [--secs=20] [--mode=roam|idle]
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

const DRIVE = (mode, secs) => `
(async () => {
  const p = window.__pets[0];
  const t0 = performance.now();
  let frames = 0; const slow = [];
  let last = t0;
  if (${mode === 'roam'}) {
    p.cfg.roamEnabled = true;
    var rt = setInterval(() => { if (p.roamRaf === null && !p.dragging) p.roam(); }, 700);
  }
  await new Promise((res) => {
    const step = (t) => {
      const dt = t - last; last = t; frames++;
      if (dt > 40) slow.push({ at: Math.round(t - t0), ms: Math.round(dt) });
      if (t - t0 < ${secs * 1000}) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
  if (${mode === 'roam'}) clearInterval(rt);
  return { frames, fps: +(frames / ${secs}).toFixed(1), slow: slow.length, slowMs: slow.map((s) => s.ms) };
})()`;

function snapshot() {
  const m = app.getAppMetrics();
  const by = {};
  for (const p of m) {
    const t = p.type || 'unknown';
    by[t] = by[t] || { cpu: 0, mem: 0 };
    by[t].cpu = +(by[t].cpu + (p.cpu.percentCPUUsage || 0)).toFixed(1);
    by[t].mem = +(by[t].mem + (p.memory.workingSetSize || 0) / 1024).toFixed(0);
  }
  return by;
}

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

  const a = snapshot();
  const r = await win.webContents.executeJavaScript(DRIVE(MODE, SECS)).catch((e) => ({ err: String(e) }));
  const b = snapshot();

  const delta = {};
  for (const k of Object.keys(b)) {
    delta[k] = { cpu: +((b[k].cpu - (a[k] ? a[k].cpu : 0)) / 1).toFixed(1), mem: b[k].mem };
  }
  console.log('BENCH ' + JSON.stringify({ mode: MODE, secs: SECS, page: r, procNow: b, procDeltaCpu: delta }));
  app.quit();
});
