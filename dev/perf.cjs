'use strict';
// 性能采样：开一个和正式桌宠同样配置的透明置顶窗，分阶段测帧率 / 长任务 / 换动画耗时，
// 并做气泡 backdrop-filter 的 A/B 对比，用来定位"卡顿"到底出在哪。
// 用法：runtime/electron/electron.exe dev/perf.cjs
const { app, BrowserWindow, screen } = require('electron');

const ARGV = process.argv.slice(2);
const argOf = (n, d) => {
  const hit = ARGV.find((a) => a === n || a.startsWith(n + '='));
  if (!hit) return d;
  return hit.includes('=') ? hit.split('=')[1] : d;
};
const PORT = Number(argOf('--port', process.env.WB_PET_PORT || 7715));
const ONLY = argOf('--only', '');

// 和正式桌宠一致：关掉窗口遮挡计算，否则常驻置顶窗会被判"被挡住"而停止出帧
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const PERF_FN = `
window.__perf = (ms) => new Promise((resolve) => {
  const deltas = [];
  const long = [];
  const po = new PerformanceObserver((list) => { for (const e of list.getEntries()) long.push(Math.round(e.duration)); });
  try { po.observe({ entryTypes: ['longtask'] }); } catch {}
  let last = performance.now();
  const t0 = last;
  const step = (t) => {
    deltas.push(t - last); last = t;
    if (t - t0 < ms) requestAnimationFrame(step);
    else {
      try { po.disconnect(); } catch {}
      const d = deltas.slice(3).sort((a, b) => a - b);
      const q = (p) => (d.length ? +d[Math.min(d.length - 1, Math.floor(d.length * p))].toFixed(1) : 0);
      resolve({
        frames: d.length, fps: +(d.length / (ms / 1000)).toFixed(1),
        p50: q(0.5), p95: q(0.95), p99: q(0.99), max: +Math.max(...d, 0).toFixed(1),
        jank: d.filter((x) => x > 32).length, longtasks: long,
      });
    }
  };
  requestAnimationFrame(step);
});
true;
`;

const ROAM_ON = `
(() => {
  const p = window.__pets[0];
  p.cfg.roamEnabled = true;
  if (!window.__roamTimer) {
    window.__roamTimer = setInterval(() => { if (p && p.roamRaf === null && !p.dragging) p.roam(); }, 400);
  }
  return true;
})()`;

const ROAM_OFF = `(() => { clearInterval(window.__roamTimer); window.__roamTimer = null; return true; })()`;

const BUBBLE_ON = (filter) => `
(() => {
  const p = window.__pets[0];
  if (!window.__bubTimer) {
    window.__bubTimer = setInterval(() => {
      p.say('卡顿测试卡顿测试卡顿测试', null, 0);
      for (const b of document.querySelectorAll('.pet-bubble')) b.style.backdropFilter = ${JSON.stringify(filter)};
    }, 300);
  }
  return true;
})()`;

const BUBBLE_OFF = `
(() => {
  clearInterval(window.__bubTimer); window.__bubTimer = null;
  for (const p of window.__pets || []) p.hideBubble();
  for (const b of document.querySelectorAll('.pet-bubble')) b.style.backdropFilter = '';
  return true;
})()`;

app.whenReady().then(async () => {
  const wa = screen.getPrimaryDisplay().workArea;
  const small = argOf('--win', '') === 'small';
  // --win=small：只开一块和角色差不多大的窗口，用来验证"全屏透明窗合成"是不是卡顿来源
  const bounds = small
    ? { x: wa.x + wa.width - 620, y: wa.y + wa.height - 380, width: 620, height: 380 }
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
  await win.loadURL(`http://127.0.0.1:${PORT}/?desktop=1`);
  await new Promise((r) => setTimeout(r, 3500));
  await win.webContents.executeJavaScript(PERF_FN).catch(() => {});

  const js = (code) => win.webContents.executeJavaScript(code).catch(() => null);
  const run = async (label, ms) => {
    const r = await js(`window.__perf(${ms})`);
    console.log(label, JSON.stringify(r));
  };

  const want = (k) => !ONLY || ONLY.split(',').includes(k);

  if (want('idle')) {
    await js(ROAM_OFF);
    await run('[A 待机 8s       ]', 8000);
  }

  if (want('roam')) {
    await js(ROAM_ON);
    await run('[B 漫游 8s       ]', 8000);
  }

  if (want('bubble')) {
    await js(BUBBLE_ON('blur(6px)'));
    await run('[C 漫游+气泡 blur]', 8000);
    await js(BUBBLE_ON('none'));
    await run('[D 漫游+气泡 无模糊]', 8000);
    await js(BUBBLE_OFF);
    await js(ROAM_OFF);
  }

  if (want('switch')) {
    const C = await js(`
      (() => {
        const p = window.__pets[0];
        const P = Object.getPrototypeOf(p);
        const origSwitch = P.switchTo;
        const origPlay = HTMLMediaElement.prototype.play;
        const rec = [];
        let pending = null;
        HTMLMediaElement.prototype.play = function () {
          if (pending && this.dataset.anim === pending.anim && pending.end === undefined) {
            pending.end = performance.now();
            rec.push({ anim: pending.anim, load: +(pending.end - pending.t0).toFixed(1) });
            pending = null;
          }
          return origPlay.apply(this, arguments);
        };
        P.switchTo = function (anim, once, opts) {
          if (!pending) pending = { anim, t0: performance.now(), end: undefined };
          return origSwitch.call(this, anim, once, opts);
        };
        const slow = [];
        let last = performance.now();
        const t0 = last;
        const tick = (t) => {
          const dt = t - last; last = t;
          if (dt > 32) slow.push({ at: Math.round(t - t0), ms: Math.round(dt), anim: p.anim });
          if (t - t0 < 25000) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        return new Promise((res) => setTimeout(() => {
          P.switchTo = origSwitch;
          HTMLMediaElement.prototype.play = origPlay;
          const load = rec.map((r) => r.load).sort((a, b) => a - b);
          res({
            switches: rec.length,
            load: { p50: load[Math.floor(load.length / 2)] ?? 0, p90: load[Math.floor(load.length * 0.9)] ?? 0, max: load[load.length - 1] ?? 0 },
            slowFrames: slow,
            slowest: rec.sort((a, b) => b.load - a.load).slice(0, 5),
          });
        }, 25500));
      })()
    `);
    console.log('[E 自然链 25s     ]', JSON.stringify(C));
  }

  if (want('micro')) {
    const M = await js(`
      (async () => {
        const names = ['小提琴演奏', '荡秋千', '吹气球', '骑木马'];
        const out = [];
        const t = (fn) => { const a = performance.now(); return fn().then(() => +(performance.now() - a).toFixed(1)); };
        async function loadOnce(name, mode) {
          const v = document.createElement('video');
          v.muted = true; v.preload = 'auto';
          if (mode === 'fetch-first') {
            await fetch('assets/webm/' + encodeURIComponent(name) + '.webm').then((r) => r.arrayBuffer());
          }
          const ms = await t(() => new Promise((res, rej) => {
            v.addEventListener('loadeddata', res, { once: true });
            v.addEventListener('error', rej, { once: true });
            v.src = 'assets/webm/' + encodeURIComponent(name) + '.webm';
          }));
          v.removeAttribute('src'); v.load();
          return ms;
        }
        for (const n of names) {
          out.push({ name: n, cold: await loadOnce(n, 'plain'), warm: await loadOnce(n, 'fetch-first') });
        }
        // 再来一轮，此时文件已在 HTTP 缓存里
        const again = [];
        for (const n of names) again.push({ name: n, cached: await loadOnce(n, 'plain') });
        return { out, again };
      })()
    `);
    console.log('[F 换动画加载      ]', JSON.stringify(M));
  }

  if (want('hit')) {
    // 端到端校验：拿当前显示帧的真实 alpha，和 p.hits() 的预测逐点比对
    const H = await js(`
      (() => {
        const p = window.__pets[0];
        const front = p.frontIsA ? p.videos[0] : p.videos[1];
        const c = document.createElement('canvas');
        c.width = 640; c.height = 360;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(front, 0, 0, 640, 360);
        const d = ctx.getImageData(0, 0, 640, 360).data;
        let tp = 0, fp = 0, fn = 0, tn = 0;
        const fpPts = [], fnPts = [];
        for (let vy = 2; vy < 360; vy += 6) {
          for (let vx = 2; vx < 640; vx += 6) {
            const alpha = d[(vy * 640 + vx) * 4 + 3];
            const solid = alpha > 40;
            const px = p.pos.x + (vx / 640) * p.size;
            const py = p.pos.y + p.bottomPad + (vy / 360) * p.h;
            const pred = p.hits(px, py);
            if (pred && solid) tp++;
            else if (pred && !solid) { fp++; if (fpPts.length < 6) fpPts.push([vx, vy]); }
            else if (!pred && solid) { fn++; if (fnPts.length < 6) fnPts.push([vx, vy]); }
            else tn++;
          }
        }
        const total = tp + fp + fn + tn;
        return {
          anim: p.anim, total,
          hitRate: +(100 * (tp / (tp + fp || 1))).toFixed(1),      // 判命中的点里有多少真有像素
          coverRate: +(100 * (tp / (tp + fn || 1))).toFixed(1),    // 真有像素的点里有多少判中了
          falsePositive: +(100 * fp / total).toFixed(2),
          falseNegative: +(100 * fn / total).toFixed(2),
          fpSample: fpPts, fnSample: fnPts,
        };
      })()
    `);
    console.log('[G 命中掩码校验    ]', JSON.stringify(H));
  }

  if (want('stall')) {
    const WARM = argOf('--warm', '0') === '1';
    // 抓 20s 漫游里的长任务，并打印它前面最近的几个动作，定位到底卡在哪个调用
    const S = await js(`
      (async () => {
        const p = window.__pets[0];
        const P = Object.getPrototypeOf(p);
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        p.cfg.roamEnabled = true;
        ${WARM ? `
        // 预热：先飞一小段，把"首次移动"的合成器开销提前花掉
        for (let i = 0; i < 6; i++) { if (p.roamRaf === null) p.roam(); await sleep(700); }
        await sleep(1200);
        ` : ''}
        const marks = [];
        const mark = (n) => { marks.push({ n, t: performance.now() }); if (marks.length > 200) marks.shift(); };
        const wrap = (name) => {
          const orig = P[name];
          if (!orig) return;
          P[name] = function () { mark(name); return orig.apply(this, arguments); };
        };
        ['switchTo', 'roam', '_recover', 'pickNext', 'tryMove', '_startThrow', '_startSquash', '_applyPos'].forEach(wrap);
        const origAppend = Element.prototype.appendChild;
        let long = [];
        const po = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (e.duration < 80) continue;
            const at = e.startTime;
            const near = marks.filter((m) => m.t <= at + 4).slice(-6).map((m) => m.n + '@' + Math.round(m.t - at));
            long.push({ ms: Math.round(e.duration), prev: near });
          }
        });
        try { po.observe({ entryTypes: ['longtask'] }); } catch {}
        const t = setInterval(() => { if (p.roamRaf === null && !p.dragging) p.roam(); }, 700);
        return await new Promise((res) => setTimeout(() => {
          clearInterval(t); po.disconnect();
          res({ long, videos: [...document.querySelectorAll('video')].map((v) => v.dataset.anim + ':' + v.readyState) });
        }, 20000));
      })()
    `);
    console.log('[H 长任务定位      ]', JSON.stringify(S));
  }

  app.quit();
});
