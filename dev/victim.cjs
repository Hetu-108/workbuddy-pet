'use strict';
/**
 * "受害者"实验：桌宠窗在上面时，别的窗口还跑得动吗？
 *  - 受害者窗：不透明的普通窗口，只做 rAF 计数 + 一个移动方块（模拟正常应用）
 *  - 对照组：桌宠窗隐藏 / 全屏透明 / 小尺寸透明 / 全屏但画面静止
 *
 *   runtime/electron/electron.exe dev/victim.cjs
 */
const { app, BrowserWindow, screen } = require('electron');

const ARGV = process.argv.slice(2);
const PORT = Number(process.env.WB_PET_PORT || 7715);

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const VICTIM = `
(async () => {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;width:80px;height:80px;background:#2f6df6;border-radius:12px;left:40px;top:40px';
  document.body.appendChild(box);
  document.body.style.background = '#f4f4f4';
  const t0 = performance.now();
  let last = t0, frames = 0, max = 0, over33 = 0, sum = 0;
  await new Promise((res) => {
    const step = (t) => {
      const dt = t - last; last = t; frames++; sum += dt;
      if (dt > max) max = dt;
      if (dt > 24) over33++;
      box.style.transform = 'translate3d(' + (200 + Math.sin(t / 300) * 200) + 'px,0,0)';
      if (t - t0 < 8000) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
  return { frames, fps: +(frames / 8).toFixed(1), avg: +(sum / frames).toFixed(1), max: +max.toFixed(1), over24: over33 };
})()`;

app.whenReady().then(async () => {
  const wa = screen.getPrimaryDisplay().workArea;

  const victim = new BrowserWindow({
    x: wa.x + 120, y: wa.y + 120, width: 900, height: 640,
    backgroundColor: '#ffffff', frame: true, show: false,
    webPreferences: { backgroundThrottling: false },
  });
  await victim.loadURL('data:text/html,<html><body></body></html>');

  const pet = new BrowserWindow({
    x: wa.x, y: wa.y, width: wa.width, height: wa.height,
    transparent: true, frame: false, hasShadow: false, resizable: false,
    skipTaskbar: true, show: false, backgroundColor: '#00000000',
    webPreferences: { backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  pet.setAlwaysOnTop(true, 'screen-saver');
  pet.setIgnoreMouseEvents(true, { forward: true });
  try { await pet.loadURL(`http://127.0.0.1:${PORT}/?desktop=1`); }
  catch (e) { console.log('LOAD_FAIL ' + e.message); app.quit(); return; }
  await new Promise((r) => setTimeout(r, 3000));

  victim.show();
  victim.focus();
  await new Promise((r) => setTimeout(r, 600));

  const measure = async (label) => {
    const r = await victim.webContents.executeJavaScript(VICTIM).catch((e) => ({ err: String(e) }));
    console.log(label, JSON.stringify(r));
  };

  pet.hide();
  await measure('[A 无桌宠         ]');

  pet.showInactive();
  await measure('[B 全屏透明窗     ]');

  pet.setBounds({ x: wa.x + wa.width - 640, y: wa.y + wa.height - 400, width: 640, height: 400 });
  await measure('[C 小透明窗 640x400]');

  // D：全屏透明窗，但把页面里的动画全停（不播视频、不做位置更新）
  pet.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height });
  await pet.webContents.executeJavaScript(`
    document.querySelectorAll('video').forEach((v) => { v.pause(); v.style.visibility = 'hidden'; });
    true;
  `).catch(() => {});
  await measure('[D 全屏但画面静止 ]');

  app.quit();
});
