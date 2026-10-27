'use strict';
// 渲染进程与桌面壳之间的最小桥：只暴露 4 个动作，不做任意 IPC 透传。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wbDesktop', {
  isDesktop: true,
  /** 悬停在鱼身上时打开鼠标事件，离开时穿透到桌面 */
  setInteractive: (v) => ipcRenderer.send('wb:interactive', !!v),
  /** 隐藏到托盘 */
  hide: () => ipcRenderer.send('wb:hide'),
  /** 退出整个桌宠 */
  quit: () => ipcRenderer.send('wb:quit'),
  /** 窗口尺寸 / 工作区信息（首帧布局用） */
  getWorkArea: () => ipcRenderer.invoke('wb:workarea'),
  /** 把整个窗口挪到屏幕坐标 (x, y)：窗口跟随角色移动，避免全屏透明窗的合成开销 */
  moveTo: (x, y) => ipcRenderer.send('wb:move', x, y),
  /** 要输入框能打字，窗口必须先拿到键盘焦点（鼠标穿透不影响键盘焦点） */
  focus: () => ipcRenderer.send('wb:focus'),
  /** 主进程按下 Ctrl+Alt+L 时通知页面唤起对话框 */
  onOpenChat: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('wb:open-chat', () => { try { cb(); } catch { /* noop */ } });
  },
});
