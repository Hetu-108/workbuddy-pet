'use strict';
/**
 * 大肥鱼桌宠 · 桌面壳
 *  - 铺满工作区的透明无边框窗口，always-on-top
 *  - 默认鼠标穿透（点得到下面的桌面/窗口），只有光标落在鱼身上时才接收鼠标
 *  - 托盘常驻：显示/隐藏、开机自启、退出；Ctrl+Alt+P 快速藏猫猫
 *  - 内置启动本地桥（server.mjs）；若已有实例在跑就直接复用
 *
 * 开发自检：electron.exe wb-pet/desktop --selftest [--shot-out=路径]
 */

const {
  app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage,
  globalShortcut, desktopCapturer, session, shell,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ARGV = process.argv.slice(2);
const argOf = (name, dflt) => {
  for (let i = 0; i < ARGV.length; i++) {
    const a = ARGV[i];
    if (a === name && ARGV[i + 1]) return ARGV[i + 1];
    if (a.startsWith(name + '=')) return a.slice(name.length + 1);
  }
  return dflt;
};
const SELFTEST = ARGV.includes('--selftest');
const SHOT_OUT = argOf('--shot-out', path.join(__dirname, 'selftest.png'));

const APP_ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.WB_PET_PORT || argOf('--port', 7715));
const BASE = `http://127.0.0.1:${PORT}`;

let win = null;
let tray = null;
let serverChild = null;
let hidden = false;
let interactive = false;

// 崩溃自愈：进程内自救，不依赖任何外部脚本或计划任务。
// 未捕获异常 / 渲染进程崩掉 → 自己 relaunch 一次；启动 5 秒内又崩说明是稳定错误，不再重试。
// 正常退出（托盘 / Ctrl+Alt+Q）走 app.quit()，不会碰到这里。
// 刚启动 5 秒内就崩，说明是稳定的启动期错误，重启也没用，直接放弃，避免无限重启。
const BOOT_AT = Date.now();
let RELAUNCHING = false;
function relaunchSelf(reason) {
  if (RELAUNCHING || SELFTEST) return;
  if (Date.now() - BOOT_AT < 5000) {
    try { console.error('[self-heal] 启动期崩溃，不再重启：', reason); } catch { /* noop */ }
    return;
  }
  RELAUNCHING = true;
  try { console.error('[self-heal] 自己重启一次：', reason); } catch { /* noop */ }
  try { app.relaunch(); } catch { /* noop */ }
  app.exit(1);
}

// 开发/排查用：--cdp-port=9222 或 WB_PET_CDP=9222 打开 DevTools 协议端口
const CDP_PORT = process.env.WB_PET_CDP || argOf('--cdp-port', '');
if (CDP_PORT) app.commandLine.appendSwitch('remote-debugging-port', String(CDP_PORT));

// 常驻置顶窗不会获得焦点，Windows/Chromium 的「窗口遮挡计算」可能把整窗判成被挡住而停止出帧。
// 关掉它，保证没人操作时动画也照常跑。
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// ---------------- 本地桥 ----------------
function ping(timeout = 700) {
  return new Promise((resolve) => {
    const req = http.get(`${BASE}/api/info`, { timeout }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function ensureBridge() {
  if (await ping()) return true;
  // 用 Electron 自带的 Node 跑 server.mjs，免得用户电脑上没装 node
  serverChild = spawn(
    process.execPath,
    [path.join(APP_ROOT, 'server.mjs'), '--port', String(PORT)],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore', windowsHide: true },
  );
  serverChild.on('error', (e) => console.error('[wb-pet] 本地桥启动失败', e));
  for (let i = 0; i < 100; i++) {
    if (await ping(400)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

// ---------------- 窗口 ----------------
// 整块工作区铺满，鱼可以在全屏任何位置活动（抛掷、漫游都能飞到屏幕上半部分）。
function workArea() {
  const d = screen.getPrimaryDisplay();
  return d.workArea; // 不含任务栏，鱼正好站在任务栏上面
}

function createWindow() {
  const wa = workArea();
  win = new BrowserWindow({
    x: wa.x,
    y: wa.y,
    width: wa.width,
    height: wa.height,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: true,
    show: false,
    backgroundColor: '#00000000',
    title: '大肥鱼桌宠',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });

  win.once('ready-to-show', () => win.showInactive());
  win.on('closed', () => { win = null; });
  win.webContents.on('render-process-gone', (_e, d) => {
    console.error('[wb-pet] 渲染进程异常退出', d);
  });
  win.webContents.on('console-message', (...args) => {
    const ev = args[0] || {};
    const msg = typeof args[2] === 'string' ? args[2] : ev.message;
    const lvl = typeof args[1] === 'number' ? args[1] : ev.level;
    if (msg) console.log('[page]', lvl, msg);
  });

  win.loadURL(`${BASE}/?desktop=1`);

  if (SELFTEST) runSelfTest();
}

function setInteractive(next, viaDrag = false) {
  if (!win || win.isDestroyed()) return;
  if (next === interactive && !viaDrag) return;
  interactive = next;
  // forward: true 让页面在穿透状态下依然能收到 mousemove，才能判断要不要接管
  win.setIgnoreMouseEvents(!next, { forward: true });
}

// 唤起对话框：先把窗口叫出来并拿到键盘焦点，再让页面把输入条亮起来。
// 窗口平时是鼠标穿透的，但键盘焦点和穿透互不影响 —— 所以这里不动 setInteractive。
function openChat() {
  if (!win || win.isDestroyed()) return;
  if (hidden || !win.isVisible()) { win.showInactive(); hidden = false; updateTray(); }
  win.show();
  win.focus();
  win.webContents.send('wb:open-chat');
}

function toggleWindow() {  if (!win) return;
  if (win.isVisible() && !hidden) {
    win.hide();
    hidden = true;
    updateTray();
  } else {
    win.showInactive();
    hidden = false;
    updateTray();
  }
}

const AUTOSTART_DIR = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const AUTOSTART_LNK = path.join(AUTOSTART_DIR, '大肥鱼桌宠.vbs');

function autostartEnabled() {
  try { return fs.existsSync(AUTOSTART_LNK); } catch { return false; }
}

function setAutostart(on) {
  try {
    if (on) {
      const exe = process.execPath;
      // VBScript 里字符串内部的引号要写成两个，所以 "a" 要变成 """a"""
      const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
      const cmd = q(exe) + ' ' + q(__dirname);
      const vbs = [
        'Set sh = CreateObject("WScript.Shell")',
        'sh.Run ' + q(cmd) + ', 0, False',
      ].join('\r\n');
      fs.mkdirSync(AUTOSTART_DIR, { recursive: true });
      // wscript 按系统 ANSI 读脚本，用 UTF-8 存会让中文路径变乱码 —— 改存 UTF-16LE + BOM
      fs.writeFileSync(AUTOSTART_LNK, '\ufeff' + vbs, 'utf16le');
    } else if (fs.existsSync(AUTOSTART_LNK)) {
      fs.unlinkSync(AUTOSTART_LNK);
    }
  } catch (e) {
    console.error('[wb-pet] 设置开机自启失败', e);
  }
  updateTray();
}

function updateTray() {
  if (!tray) return;
  const visible = !!win && win.isVisible() && !hidden;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? '先藏起来（Ctrl+Alt+P）' : '让大肥鱼出来（Ctrl+Alt+P）', click: toggleWindow },
    { label: '回到右下角', click: () => send('home') },
    { label: '说句话', click: () => send('say') },
    { label: '和它说话（Ctrl+Alt+L）', click: openChat },
    { type: 'separator' },
    { label: '开机自启', type: 'checkbox', checked: autostartEnabled(), click: (i) => setAutostart(i.checked) },
    { label: '在浏览器里打开（调样式用）', click: () => shell.openExternal(`${BASE}/?bg=1`) },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]));
  tray.setToolTip(visible ? '大肥鱼：在呢' : '大肥鱼：躲起来了');
}

function send(kind) {
  if (!win || win.isDestroyed()) return;
  const msg = kind === 'home'
    ? { wbPetType: 'anim', name: '待机呼吸休闲' }
    : { wbPetType: 'say', text: '我在呢～' };
  win.webContents.executeJavaScript(
    `window.wbPet && ${kind === 'home' ? 'window.wbPet.home()' : `window.wbPet.say(${JSON.stringify(msg.text)})`}`
  ).catch(() => {});
}

function createTray() {
  const iconPath = path.join(APP_ROOT, 'assets', 'logo.png');
  let img = nativeImage.createFromPath(iconPath);
  if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.on('click', toggleWindow);
  updateTray();
}

// ---------------- 自检（开发用） ----------------
async function runSelfTest() {
  await new Promise((r) => setTimeout(r, 4200));
  try {
    try {
      const probe = await win.webContents.executeJavaScript(
        `({ pets: (window.__pets || []).length,
            roots: document.querySelectorAll('.pet-root').length,
            hits: document.querySelectorAll('.pet-hit').length,
            bubbles: document.querySelectorAll('.pet-bubble').length,
            videos: document.querySelectorAll('video').length })`
      );
      console.log('[probe]', JSON.stringify(probe));
    } catch { /* 忽略探针失败 */ }
    const shot = await win.webContents.capturePage();
    fs.writeFileSync(SHOT_OUT.replace(/\.png$/, '-window.png'), shot.toPNG());
    if (ARGV.includes('--pointer')) {
      const res = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const p = window.__pets[0];
        const cap = () => document.body.dataset.petCapturing;
        const center = () => {
          const r = p.root.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        };
        const move = (x, y) => window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));

        const out = {};
        if (p.roamRaf != null) p._stopRoam();
        p.pos = p._anchorPixel();
        p._applyPos(true);
        await sleep(150);

        // A 光标压在静止的鱼身上：应该接管（否则点不到它）
        let q = center();
        move(q.x, q.y);
        await sleep(220);
        out.staticHit = cap();

        // B 鱼自己走开，鼠标一动不动：应该自动放开。这是「滚轮滚不动」的根因场景
        p.pos = { x: Math.max(0, q.x - 700), y: Math.max(0, q.y - 320) };
        p._applyPos(true);
        await sleep(420);
        out.afterMovingAway = cap();
        out.hitNow = !!window.__desktop.hitTest(q.x, q.y);
        out.forced = window.__desktop.forced();
        out.holdLeft = window.__desktop.holdLeft();

        // C 鱼正在漫游时经过光标：不应该接管
        p.pos = p._anchorPixel();
        p._applyPos(true);
        await sleep(150);
        out.roamReturn = p.roam();
        await sleep(80);
        q = center();
        move(q.x, q.y);
        await sleep(160);
        out.duringRoam = cap();
        out.roamRafActive = p.roamRaf != null;
        if (p.roamRaf != null) p._stopRoam();
        p.pos = p._anchorPixel();
        p._applyPos(true);
        await sleep(250);

        // D 光标压在静止的鱼身上滚轮：应该马上让路，别把下面的滚动吞掉
        q = center();
        move(q.x, q.y);
        await sleep(220);
        out.beforeWheel = cap();
        window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
        await sleep(80);
        out.afterWheel = cap();
        await sleep(900);
        out.afterMute = cap();   // 冷却结束、光标仍在鱼上：应该恢复接管，不然点不到它
        return out;
      })()`);
      console.log('[pointer-test]', JSON.stringify(res));
    }
    if (ARGV.includes('--roam')) {
      await win.webContents.executeJavaScript('window.__pets[0].roam()');
      await new Promise((r) => setTimeout(r, 4200));
      const s2 = await win.webContents.capturePage();
      fs.writeFileSync(SHOT_OUT.replace(/\.png$/, '-roam-win.png'), s2.toPNG());
    }
    if (ARGV.includes('--menu')) {
      const geo = await win.webContents.executeJavaScript(`(() => {
        const p = window.__pets[0];
        const r = p.root.getBoundingClientRect();
        p._openMenu(r.left + r.width / 2, Math.max(40, r.top + 40));
        const items = [...document.querySelectorAll('.pet-menu-item')];
        const act = items.find((el) => el.textContent.trim().startsWith('动作'));
        if (act) act.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        setTimeout(() => {
          const sub = [...document.querySelectorAll('.pet-menu-item')].find((el) => el.textContent.trim().startsWith('小动作'));
          if (sub) sub.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        }, 250);
        return new Promise((res) => setTimeout(() => res({
          vw: window.innerWidth, vh: window.innerHeight,
          cols: [...document.querySelectorAll('.pet-menu-column')].map((el) => {
            const q = el.getBoundingClientRect();
            return { l: Math.round(q.left), t: Math.round(q.top), w: Math.round(q.width), h: Math.round(q.height) };
          }),
        }), 800));
      })()`);
      console.log('[menu-geo]', JSON.stringify(geo));
      await new Promise((r) => setTimeout(r, 400));
      const s3 = await win.webContents.capturePage();
      fs.writeFileSync(SHOT_OUT.replace(/\.png$/, '-menu.png'), s3.toPNG());
    }
    // 对话自检：--chat 会真的发一句话给大脑，等气泡出来再读数
    if (ARGV.includes('--chat')) {
      const sent = await win.webContents.executeJavaScript(`(() => {
        if (!window.wbChat) return { err: 'no chat api' };
        window.wbChat.open();
        window.wbChat.send('你好呀，你在干什么');
        return { ok: true };
      })()`);
      console.log('[chat-send]', JSON.stringify(sent));
      await new Promise((r) => setTimeout(r, 15000));
      const chat = await win.webContents.executeJavaScript(`(() => {
        const p = window.__pets[0];
        return {
          bubble: p.bubText.textContent,
          on: p.bubble.classList.contains('is-on'),
          anim: p.anim,
          busy: !!(window.wbChat && window.wbChat.busy),
          tip: (document.querySelector('.pet-chat-tip') || {}).textContent || '',
        };
      })()`);
      console.log('[chat-result]', JSON.stringify(chat));
      const shot4 = await win.webContents.capturePage();
      fs.writeFileSync(SHOT_OUT.replace(/\.png$/, '-chat.png'), shot4.toPNG());
    }

    if (ARGV.includes('--click')) {      const res = await win.webContents.executeJavaScript(`(() => {
        const hit = document.querySelector('.pet-hit');
        const r = hit.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const opt = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };
        hit.dispatchEvent(new PointerEvent('pointerdown', opt));
        hit.dispatchEvent(new PointerEvent('pointerup', opt));
        return { anim: window.__pets[0].anim, audio: window.__sound.state(), enabled: window.__sound.enabled() };
      })()`);
      console.log('[click-test]', JSON.stringify(res));
    }
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1200 },
    });
    if (sources[0]) fs.writeFileSync(SHOT_OUT, sources[0].thumbnail.toPNG());
    console.log('[selftest] saved', SHOT_OUT);
  } catch (e) {
    console.error('[selftest] failed', e);
  } finally {
    app.quit();
  }
}

// ---------------- 生命周期 ----------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { win.showInactive(); hidden = false; updateTray(); }
  });

  app.whenReady().then(async () => {
    if (app.isPackaged) { /* 打包后同样是本地页面 */ }
    // 透明窗口需要允许媒体自动播放与本地请求
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
      cb(permission === 'media' || permission === 'notifications');
    });

    const ok = await ensureBridge();
    if (!ok) console.error('[wb-pet] 本地桥没起来，页面可能空白');

    createWindow();
    if (!SELFTEST) createTray();

    globalShortcut.register('CommandOrControl+Alt+P', toggleWindow);
    globalShortcut.register('CommandOrControl+Alt+Q', () => app.quit());
    globalShortcut.register('CommandOrControl+Alt+L', openChat);

    screen.on('display-metrics-changed', () => {
      if (win && !win.isDestroyed()) win.setBounds(workArea());
    });
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (serverChild && !serverChild.killed) {
      try { serverChild.kill(); } catch { /* noop */ }
    }
  });

  // 主进程兜不住的异常 → 自己回来
  process.on('uncaughtException', (e) => relaunchSelf('uncaughtException: ' + (e && e.message)));
  // 渲染进程崩了（GPU 崩了 Electron 会自己重建，不管）→ 整只鱼重开
  app.on('render-process-gone', (_e, _wc, d) => {
    if (d && d.reason === 'clean-exit') return;
    relaunchSelf('render-process-gone: ' + (d && d.reason));
  });
}

// ---------------- IPC ----------------
ipcMain.on('wb:interactive', (_e, v) => setInteractive(!!v));
ipcMain.on('wb:focus', () => {
  if (!win || win.isDestroyed()) return;
  if (hidden || !win.isVisible()) { win.showInactive(); hidden = false; }
  win.show();
  win.focus();
});
ipcMain.on('wb:hide', () => { if (win) { win.hide(); hidden = true; updateTray(); } });
ipcMain.on('wb:quit', () => app.quit());
ipcMain.handle('wb:workarea', () => workArea());
