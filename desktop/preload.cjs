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
});
