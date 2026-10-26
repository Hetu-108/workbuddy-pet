// 极端对照：只开一个 900x640 的不透明窗口，完全不涉及桌宠，看它会不会卡
const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ x: 200, y: 200, width: 900, height: 640, backgroundColor: '#ffffff', show: false,
    webPreferences: { backgroundThrottling: false } });
  await w.loadURL('data:text/html,<body style="margin:0"><div id=b style="width:80px;height:80px;background:%232f6df6;border-radius:12px"></div></body>');
  w.show(); w.focus();
  await new Promise((r) => setTimeout(r, 1200));
  const r = await w.webContents.executeJavaScript(`
    (async () => {
      const b = document.getElementById('b');
      const t0 = performance.now(); let last = t0, frames = 0; const slow = [];
      await new Promise((res) => {
        const step = (t) => {
          const dt = t - last; last = t; frames++;
          if (dt > 40) slow.push({ at: Math.round(t - t0), ms: Math.round(dt) });
          b.style.transform = 'translateX(' + (100 + Math.sin(t / 300) * 100) + 'px)';
          if (t - t0 < 20000) requestAnimationFrame(step); else res();
        };
        requestAnimationFrame(step);
      });
      return { frames, fps: +(frames / 20).toFixed(1), slow };
    })()`);
  console.log('SOLO ' + JSON.stringify(r));
  app.quit();
});
