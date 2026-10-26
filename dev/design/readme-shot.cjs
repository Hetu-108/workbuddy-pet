'use strict';
// 分屏截 README 本地预览，用来在推送前肉眼验收
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.disableHardwareAcceleration();
const ROOT = path.resolve(__dirname, '..', '..');
const W = 976, H = 1180;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W, height: H, useContentSize: true, show: false, frame: false,
    backgroundColor: '#ffffff',
    webPreferences: { backgroundThrottling: false },
  });
  await win.loadFile(path.join(ROOT, '_readme-preview.html'));
  await win.webContents.executeJavaScript(`
    (async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => {
        i.onload = r; i.onerror = r;
      }))));
      document.querySelectorAll('details').forEach((d) => { d.open = ${process.argv.includes('--open') ? 'true' : 'false'}; });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return document.body.scrollHeight;
    })()
  `).then((h) => console.log('[height]', h));

  win.showInactive();
  await new Promise((r) => setTimeout(r, 700));

  const total = await win.webContents.executeJavaScript('document.body.scrollHeight');
  const shots = Math.min(6, Math.ceil(total / H));
  for (let k = 0; k < shots; k++) {
    await win.webContents.executeJavaScript(`window.scrollTo(0, ${k * H})`);
    await new Promise((r) => setTimeout(r, 350));
    const img = await win.webContents.capturePage();
    const out = path.join(ROOT, 'dev', `_readme-${k}.png`);
    fs.writeFileSync(out, img.toPNG());
    console.log('[shot]', k, `${k * H}px`, img.getSize().width + 'x' + img.getSize().height);
  }
  app.quit();
});
