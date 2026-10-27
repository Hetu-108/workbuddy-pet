'use strict';
// 一次性工具：读 assets/webm 里样本的真实像素尺寸。
// 用法：electron.exe dev/vidinfo.cjs
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'assets', 'webm');
const TMP = path.join(ROOT, 'dev', '_vidinfo.html');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.webm'));
  const step = Math.max(1, Math.floor(files.length / 12));
  const sample = files.filter((_, i) => i % step === 0).slice(0, 12);
  fs.writeFileSync(TMP, '<!doctype html><meta charset="utf-8"><body></body>', 'utf8');
  const win = new BrowserWindow({ show: false, width: 200, height: 200 });
  await win.loadFile(TMP);
  const out = await win.webContents.executeJavaScript(`
    (async () => {
      const list = ${JSON.stringify(sample)};
      const res = [];
      for (const f of list) {
        const v = document.createElement('video');
        v.muted = true;
        v.preload = 'metadata';
        v.src = '../assets/webm/' + encodeURIComponent(f);
        const ok = await new Promise((r) => {
          v.onloadedmetadata = () => r(true);
          v.onerror = () => r(false);
          setTimeout(() => r(false), 5000);
        });
        res.push([f, ok ? v.videoWidth + 'x' + v.videoHeight : 'fail:' + (v.error && v.error.code), Math.round(v.duration * 10) / 10]);
        v.removeAttribute('src');
      }
      return res;
    })()
  `);
  console.log('总数', files.length);
  for (const [f, dim, dur] of out) console.log('  ', String(dim).padEnd(10), dur + 's', f);
  fs.rmSync(TMP, { force: true });
  app.quit();
});
