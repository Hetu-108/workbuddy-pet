'use strict';
/**
 * 只截屏、不画宠物的小工具（避免截图实例自己也画一只鱼，画面里出现两只）。
 *
 *   electron.exe desktop --capture-only --out=路径.png [--delay=1200]
 */

const { app, desktopCapturer } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ARGV = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = ARGV.findIndex((a) => a === name || a.startsWith(name + '='));
  if (i < 0) return dflt;
  const a = ARGV[i];
  if (a.includes('=')) return a.slice(a.indexOf('=') + 1);
  return ARGV[i + 1] || dflt;
};

const OUT = argOf('--out', path.join(__dirname, 'screen.png'));
const DELAY = Number(argOf('--delay', 1200));

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, DELAY));
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1200 },
    });
    if (!sources.length) throw new Error('没有拿到屏幕源');
    fs.writeFileSync(OUT, sources[0].thumbnail.toPNG());
    console.log('[capture] saved', OUT);
  } catch (e) {
    console.error('[capture] failed', e.message);
  } finally {
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
