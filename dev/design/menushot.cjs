'use strict';
// 截一张"真跑起来"的画面：右键多级菜单展开。
// 不是画出来的示意图 —— 页面是真的 pet 应用，菜单是真的级联菜单。
//
//   electron.exe dev/design/menushot.cjs --out=dev/design/_menu-raw.png
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ARGV = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = ARGV.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

const OUT = argOf('out', 'dev/design/_menu-raw.png');
const W = Number(argOf('w', 1400));
const H = Number(argOf('h', 680));
const PORT = Number(process.env.WB_PET_PORT || 7715);

app.disableHardwareAcceleration();
const ROOT = path.resolve(__dirname, '..', '..');

// 和头图同一套背景，保证仓库里几张图是一家人
const BG = `radial-gradient(900px 620px at 88% 88%, rgba(120,148,220,.30), rgba(120,148,220,0) 62%),
            radial-gradient(700px 520px at 6% 4%, rgba(255,255,255,.9), rgba(255,255,255,0) 60%),
            linear-gradient(160deg, #ffffff 0%, #f8faff 46%, #edf1fb 100%)`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W,
    height: H,
    useContentSize: true,
    show: false,
    frame: false,
    resizable: false,
    backgroundColor: '#ffffff',
    webPreferences: { backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
  });

  try {
    await win.loadURL(`http://127.0.0.1:${PORT}/`);
  } catch (e) {
    console.log('LOAD_FAIL', e.message, '—— 桥没起?先 node wb-pet.mjs up');
    app.quit();
    return;
  }

  const res = await win.webContents.executeJavaScript(`
    (async () => {
      document.body.style.background = ${JSON.stringify(BG)};
      document.body.style.backgroundAttachment = 'fixed';

      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      // 等宠物挂载 + 视频就绪
      for (let i = 0; i < 60 && !(window.__pets && window.__pets[0]); i++) await sleep(100);
      const p = window.__pets[0];
      if (!p) return { error: 'no pet' };
      await p.init?.().catch(() => {});
      await sleep(1200);

      // 缩小一点并挪到左侧：菜单往右展开，两列就够说明"逐级点播"，缩进 880px 也能看清字
      p.size = 400;
      p.h = (p.size * 9) / 16;
      p.bottomPad = (p.size * (9 / 16) * (360 - 330)) / 360;
      p.sideAllow = (p.size * (1 - 240 / 640)) / 2;
      p.root.style.setProperty('--pet-size', p.size + 'px');
      p.pos = p._anchorPixel();
      p.pos.x = p.bounds ? p.bounds.minX + 28 : 28;
      p._applyPos(true);
      await sleep(500);

      const r = p.root.getBoundingClientRect();
      p._openMenu(r.right - 46, 200);

      const pick = (prefix) => [...document.querySelectorAll('.pet-menu-item')]
        .find((el) => el.textContent.trim().startsWith(prefix));
      await sleep(200);
      const act = pick('动作');
      if (act) act.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await sleep(900);

      return {
        cols: [...document.querySelectorAll('.pet-menu-column')].map((el) => {
          const q = el.getBoundingClientRect();
          return { l: Math.round(q.left), t: Math.round(q.top), w: Math.round(q.width), h: Math.round(q.height) };
        }),
        pet: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      };
    })()
  `).catch((e) => ({ error: String(e) }));

  console.log('[menu]', JSON.stringify(res));
  win.showInactive();
  await new Promise((r) => setTimeout(r, 900));

  const img = await win.webContents.capturePage();
  const size = img.getSize();
  const outPath = path.resolve(ROOT, OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, img.toPNG());
  console.log(`[shot] ${OUT} ${size.width}x${size.height} -> ${fs.statSync(outPath).size} bytes`);

  app.quit();
});
