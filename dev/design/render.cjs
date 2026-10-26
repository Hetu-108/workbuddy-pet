'use strict';
// 把 dev/design/*.html 渲成 PNG。
//
// 屏幕是 2560×1600 物理像素、Windows 125% 缩放 → Electron 里能看到的是 2048×1280，
// 窗口超过它就会被系统裁掉、截出半张图。所以这里先把版心用 CSS zoom 压进可用区域，
// 再靠系统缩放拿到 1.25 倍物理像素；1440 版心渲出来约 1800px 宽，
// GitHub README 正文宽约 880px，相当于 2 倍图，retina 下也清楚。
//
//   electron.exe dev/design/render.cjs --page=hero.html --out=docs/hero.png --w=1440 --h=600
const { app, BrowserWindow, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ARGV = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = ARGV.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

const PAGE = argOf('page', 'hero.html');
const OUT = argOf('out', 'docs/hero.png');
const W = Number(argOf('w', 1440));
const H = Number(argOf('h', 600));
const TRANSPARENT = ARGV.includes('--transparent');
const SEEK = Number(argOf('seek', '-1')); // 0~1：把视频定格在这个进度，取有代表性的姿态

app.disableHardwareAcceleration();

const ROOT = path.resolve(__dirname, '..', '..');

app.whenReady().then(async () => {
  const { bounds } = screen.getPrimaryDisplay();
  const zoom = Math.min(bounds.width / W, bounds.height / H, 1);
  const cssW = Math.round(W * zoom);
  const cssH = Math.round(H * zoom);

  const win = new BrowserWindow({
    width: cssW,
    height: cssH,
    useContentSize: true,
    show: false,
    frame: false,
    resizable: false,
    backgroundColor: TRANSPARENT ? '#00000000' : '#ffffff',
    transparent: TRANSPARENT,
    webPreferences: { backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
  });

  await win.loadFile(path.join(__dirname, PAGE));

  // 字体就绪 + 图片解码完 + 两帧稳定，否则会截到 fallback 字体或空白
  const info = await win.webContents.executeJavaScript(`
    (async () => {
      const st = document.createElement('style');
      st.textContent = ${JSON.stringify(`
        html, body { width: ${cssW}px !important; height: ${cssH}px !important; overflow: hidden !important; margin: 0 !important; }
        .canvas { zoom: ${zoom} !important; }
      `)};
      document.head.appendChild(st);
      await document.fonts.ready;
      await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => {
        i.onload = r; i.onerror = r;
      }))));

      // 有 <video> 的页面：等首帧解码出来再截，否则截到空白
      const vids = [...document.querySelectorAll('video')];
      await Promise.all(vids.map((v) => (v.readyState >= 2 ? null : new Promise((r) => {
        v.addEventListener('loadeddata', r, { once: true });
        v.addEventListener('error', r, { once: true });
      }))));
      await Promise.all(vids.map((v) => v.play().catch(() => {})));
      if (${SEEK} >= 0 && vids.length) {
        await Promise.all(vids.map((v) => new Promise((r) => {
          const t = Number.isFinite(v.duration) ? v.duration * ${SEEK} : 1.2;
          v.pause();
          v.addEventListener('seeked', r, { once: true });
          v.currentTime = t;
          setTimeout(r, 1500);
        })));
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return {
        fonts: [...document.fonts].map((f) => f.family + ':' + f.status),
        imgs: [...document.images].map((i) => i.naturalWidth + 'x' + i.naturalHeight),
        videos: vids.map((v) => v.readyState + '@' + v.currentTime.toFixed(2)),
      };
    })()
  `);
  console.log('[ready]', JSON.stringify(info), 'zoom=' + zoom.toFixed(4), `css=${cssW}x${cssH}`);

  win.showInactive();
  await new Promise((r) => setTimeout(r, 800));

  const img = await win.webContents.capturePage();
  const size = img.getSize();
  const outPath = path.resolve(ROOT, OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, img.toPNG());
  console.log(`[shot] ${OUT} ${size.width}x${size.height} -> ${fs.statSync(outPath).size} bytes`);

  app.quit();
});
