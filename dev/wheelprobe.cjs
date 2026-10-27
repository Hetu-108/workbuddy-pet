// 滚轮探针：一个普通（非透明）窗口，统计自己收到多少次 wheel。
// 用来验证桌宠窗口在鱼身上滚轮时是否真的让路 —— 让路时事件应该落到这个窗口。
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(process.env.TEMP || '.', 'wheelprobe.txt');

const HTML = `<!doctype html><meta charset="utf-8">
<body style="margin:0;background:#202020;color:#7fd6a0;font:44px Consolas;
display:flex;align-items:center;justify-content:center;height:100vh;overflow:hidden">
<div id="c">wheel 0</div>
<script>
let n = 0;
document.title = 'wheel:0';
addEventListener('wheel', () => {
  n += 1;
  document.title = 'wheel:' + n;
  document.getElementById('c').textContent = 'wheel ' + n;
}, { passive: true });
</script></body>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    x: 1400, y: 650, width: 600, height: 500,
    frame: false, backgroundColor: '#202020', skipTaskbar: true,
    webPreferences: { contextIsolation: true },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML));
  win.setAlwaysOnTop(false);
  console.log('[probe] ready');
  try { fs.writeFileSync(OUT, 'wheel:0'); } catch { /* noop */ }

  let last = '';
  setInterval(async () => {
    try {
      const t = await win.webContents.getTitle();
      if (t && t !== last) {
        last = t;
        console.log('[probe] ' + t);
        fs.writeFileSync(OUT, t);
      }
    } catch { /* noop */ }
  }, 250);

  setTimeout(() => app.quit(), 90000);
});
