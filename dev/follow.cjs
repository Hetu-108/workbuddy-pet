'use strict';
/**
 * 窗口策略对照实验：到底"全屏透明窗"贵在哪，以及"小窗跟随"能不能救。
 *
 *   --mode=full    铺满工作区的透明窗，鱼在里面漫游（现状）
 *   --mode=small   640x400 小窗，鱼在里面漫游（只改窗口大小）
 *   --mode=move    小窗，鱼不动，窗口按圆轨迹高速移动（只测"移窗"本身的代价）
 *   --mode=follow  小窗 + 真跟随：鱼的世界坐标不变，窗口跟着鱼走（目标方案）
 *
 * 用法：runtime/electron/electron.exe dev/follow.cjs --mode=follow --secs=20
 */
const { app, BrowserWindow, ipcMain, screen } = require('electron');

const ARGV = process.argv.slice(2);
const argOf = (n, d) => {
  const hit = ARGV.find((a) => a === n || a.startsWith(n + '='));
  if (!hit) return d;
  return hit.includes('=') ? hit.split('=')[1] : d;
};
const MODE = argOf('--mode', 'full');
const SECS = Number(argOf('--secs', '20'));
const PORT = Number(process.env.WB_PET_PORT || 7715);

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const PERF_FN = `
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
      resolve({ frames: d.length, fps: +(d.length / (ms / 1000)).toFixed(1), p50: q(0.5), p95: q(0.95), p99: q(0.99),
        max: +Math.max(...d, 0).toFixed(1), over32: d.filter((x) => x > 32).length, over80: d.filter((x) => x > 80).length,
        longtasks: long });
    }
  };
  requestAnimationFrame(step);
});
true;`;

let win = null;
let moves = 0;
console.log('[start] mode=' + MODE + ' secs=' + SECS);
process.on('uncaughtException', (e) => { console.log('[uncaught]', e && e.stack || e); process.exit(3); });
process.on('unhandledRejection', (e) => { console.log('[reject]', e && e.stack || e); process.exit(4); });

app.whenReady().then(async () => {
  try {
  const wa = screen.getPrimaryDisplay().workArea;
  const bounds = MODE === 'full'
    ? { x: wa.x, y: wa.y, width: wa.width, height: wa.height }
    : { x: Math.round(wa.x + (wa.width - 640) / 2), y: Math.round(wa.y + (wa.height - 400) / 2), width: 640, height: 400 };

  win = new BrowserWindow({
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
  win.once('ready-to-show', () => win.showInactive());

  ipcMain.on('wb:move', (_e, x, y) => {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    const nx = Math.round(x); const ny = Math.round(y);
    if (nx === b.x && ny === b.y) return;
    moves++;
    win.setBounds({ x: nx, y: ny, width: b.width, height: b.height }, false);
  });

  await win.loadURL(`http://127.0.0.1:${PORT}/?desktop=1`);
  await new Promise((r) => setTimeout(r, 3500));
  const js = (c) => win.webContents.executeJavaScript(c).catch((e) => ({ err: String(e) }));
  await js(PERF_FN);

  const gpu = await app.getGPUFeatureStatus();
  console.log('[gpu]', JSON.stringify({
    compositing: gpu.gpu_compositing, rasterization: gpu.rasterization,
    webgl: gpu.webgl, video_decode: gpu.video_decode,
  }));

  // 关键：让页面知道自己的窗口在屏幕哪儿
  const origin = await js(`({ sx: window.screenX, sy: window.screenY, dpr: devicePixelRatio })`);
  console.log('[origin]', JSON.stringify(origin), 'winBounds', JSON.stringify(win.getBounds()));

  if (MODE === 'move') {
    // 鱼不动，窗口按圆轨迹飞：纯测"移动透明小窗"的代价
    const a = await js(`
      (() => {
        const p = window.__pets[0];
        p.cfg.roamEnabled = false;
        if (p.roamRaf !== null) { cancelAnimationFrame(p.roamRaf); p.roamRaf = null; }
        const wa = { w: screen.width, h: screen.height };
        return true;
      })()
    `).catch(() => null);
    let t = 0;
    const timer = setInterval(() => {
      const wa2 = screen.getPrimaryDisplay().workArea;
      const cx = wa2.x + wa2.width / 2 + Math.cos(t) * (wa2.width / 3);
      const cy = wa2.y + wa2.height / 2 + Math.sin(t) * (wa2.height / 3);
      ipcMain.emit('wb:move', null, cx, cy);
      t += 0.09;
    }, 1000 / 120);
    const r = await js(`window.__perf(${SECS * 1000})`);
    clearInterval(timer);
    console.log(`[${MODE}]`, JSON.stringify(r), 'moves=' + moves);
    app.quit();
    return;
  }

  if (MODE === 'follow') {
    // 真跟随：世界坐标不变，窗口原点 = 鱼屏幕位置 - 内边距
    const setup = await js(`
      (() => {
        const p = window.__pets[0];
        const PAD = 40;
        window.__pad = PAD;
        window.__winX = window.screenX; window.__winY = window.screenY;
        const proto = Object.getPrototypeOf(p);
        // 鱼在窗口内的位置固定，屏幕位置靠移窗实现
        p._applyPos = function () {
          const sx = Math.round(this.pos.x) - window.__pad;
          const sy = Math.round(this.pos.y) - window.__pad;
          if (sx !== window.__winX || sy !== window.__winY) {
            window.__winX = sx; window.__winY = sy;
            window.wbDesktop.moveTo(sx, sy);
          }
        };
        p._applyPos();
        return { pad: PAD, size: p.size, pos: { x: p.pos.x, y: p.pos.y } };
      })()
    `);
    console.log('[follow-setup]', JSON.stringify(setup));
    // 让漫游在一个"世界坐标系"里跑：pos 原来是客户端坐标，现在当屏幕坐标用
    const widen = await js(`
      (() => { const p = window.__pets[0]; p.bounds = { w: screen.width, h: screen.height }; return true; })()
    `).catch(() => null);
    await js(`
      (() => {
        const p = window.__pets[0];
        p.cfg.roamEnabled = true;
        window.__rt = setInterval(() => { if (p.roamRaf === null && !p.dragging) p.roam(); }, 500);
        return true;
      })()
    `);
    const r = await js(`window.__perf(${SECS * 1000})`);
    await js(`clearInterval(window.__rt)`);
    console.log(`[${MODE}]`, JSON.stringify(r), 'moves=' + moves);
    app.quit();
    return;
  }

  // full / small：鱼在窗口里漫游
  await js(`
    (() => {
      const p = window.__pets[0];
      p.cfg.roamEnabled = true;
      window.__rt = setInterval(() => { if (p.roamRaf === null && !p.dragging) p.roam(); }, 500);
      return true;
    })()
  `);
  const r = await js(`window.__perf(${SECS * 1000})`);
  await js(`clearInterval(window.__rt)`);
  console.log(`[${MODE}]`, JSON.stringify(r), 'moves=' + moves);
  app.quit();
  } catch (e) { console.log('[fail]', e && e.stack || e); app.quit(); }
});
