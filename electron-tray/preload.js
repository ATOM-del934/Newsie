/* preload.js — 渲染进程与主进程之间的安全桥
   只暴露少数几个动作，不把 ipcRenderer / node / require 交出去。
   气泡窗口（bubble.html）和桌面鲸鱼窗口（pet.html）共用这个 preload。 */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  /* ── 气泡窗口用 ── */
  /** 收到一期新内容 */
  onIssue: (fn) => ipcRenderer.on('issue', (_e, payload) => fn(payload)),
  /** 打开速览文件（主进程用系统默认浏览器打开） */
  openIssue: (absPath) => ipcRenderer.send('open-issue', absPath),
  /** 手动收起气泡 */
  collapse: () => ipcRenderer.send('collapse'),
  /** 鼠标悬停：先别收 */
  keepOpen: () => ipcRenderer.send('keep-open'),
  /** 鼠标移开：重新计时 */
  rearm: (ms) => ipcRenderer.send('rearm', ms),

  /* ── 桌面鲸鱼窗口用 ── */
  /** 切换头像 */
  onAvatar: (fn) => ipcRenderer.on('avatar', (_e, url) => fn(url)),
  /** 未读数变化（用来点红点） */
  onUnread: (fn) => ipcRenderer.on('unread', (_e, n) => fn(n)),
  /** 显示最新一期气泡 */
  showBubble: () => ipcRenderer.send('pet:show-bubble'),
  /** 用浏览器打开最新一期 */
  openLatest: () => ipcRenderer.send('pet:open-latest'),
  /** 弹出托盘菜单 */
  popupMenu: () => ipcRenderer.send('pet:popup-menu')
});
