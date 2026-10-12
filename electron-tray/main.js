/* ══════════════════════════════════════════════════════════════════
   main.js — Electron 托盘版桌宠的主进程

   相比纯 H5 版，托盘版多出来的能力：
     1) 常驻系统托盘 —— 关掉气泡也还在，真正"关掉也准点"
     2) 真的定时器 —— 不依赖页面是否打开
     3) 真·系统通知 + 托盘图标红点（用叠加图标表示未读）
     4) 开机自启（可在菜单里开关）
   ══════════════════════════════════════════════════════════════════ */
'use strict';

const {
  app, BrowserWindow, Tray, Menu, nativeImage, ipcMain,
  shell, Notification, screen, powerMonitor, nativeTheme
} = require('electron');
const path = require('path');
const fs = require('fs');

const issuesLib = require('./issues');

const PET_DIR = issuesLib.PET_DIR;
/* 图片资源放在项目根的 assets/，网页版与托盘版共用同一套（避免两份图各自漂移） */
const ASSET_DIR = path.join(__dirname, '..', 'assets');

/* ───────── 可调配置 ───────── */
const DEFAULT_CFG = {
  weekday: 0,            // 0=周日
  hour: 20,
  minute: 0,
  autoHideMs: 12000,     // 气泡多久后自动收起
  idleAnim: true,        // 桌宠是否播放待机动作（在几个姿势之间缓慢切换）
  trayStyle: 'auto',     // 托盘图标：'auto' 按任务栏明暗自动选；也可强制 'dark'/'light'
  showPet: true,         // 是否在桌面上显示那只可拖动的地球小报童
  autostart: false,
  sound: false
};

/* ───────── 状态持久化（放在用户数据目录，升级不会丢） ───────── */
let stateFile, cfgFile;
let cfg = { ...DEFAULT_CFG };
let st = { delivered: [], unread: 0, lastShown: null, seen: [] };

function loadJSON(file, dflt) {
  try {
    let raw = fs.readFileSync(file, 'utf8');
    // 去掉 UTF-8 BOM：记事本、PowerShell 的 -Encoding UTF8 都会写入 BOM，
    // 而 JSON.parse 遇到 BOM 会直接抛错 —— 那样配置会被静默忽略、回退到默认值，
    // 用户会以为"我改了配置却不起作用"。这里必须剥掉。
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    raw = raw.trim();
    if (!raw) return { ...dflt };
    const o = JSON.parse(raw);
    return (o && typeof o === 'object' && !Array.isArray(o)) ? { ...dflt, ...o } : { ...dflt };
  } catch (e) {
    dbg('loadJSON 失败 ' + file + ' : ' + e.message);
    return { ...dflt };
  }
}
function saveJSON(file, obj) {
  try {
    // 显式写 UTF-8 无 BOM，保证下次能被自己读回来
    fs.writeFileSync(file, Buffer.from(JSON.stringify(obj, null, 2), 'utf8'));
  }
  catch (e) { console.error('[weeklypet] 保存失败', file, e.message); }
}
const saveCfg = () => saveJSON(cfgFile, cfg);
const saveSt = () => saveJSON(stateFile, st);

/* 调试日志：只在 --selftest / --shot 模式下写，正常运行时不留垃圾 */
const DBG_FILE = path.join(__dirname, 'debug.log');
const DBG_ON = process.argv.includes('--selftest') ||
               process.argv.some(a => a.startsWith('--shot='));
function dbg(msg) {
  if (!DBG_ON) return;
  try { fs.appendFileSync(DBG_FILE, new Date().toISOString() + '  ' + msg + '\n', 'utf8'); } catch (e) {}
}

/* ───────── 图标 ───────── */
/* 角色是「地球小报童」，本身就是透明底，不再需要"带底板 / 抠底板"两套。
   参数保留只是为了不改动调用处。 */
function iconPath() {
  const a = path.join(ASSET_DIR, 'pet.png');
  const b = path.join(ASSET_DIR, 'pet-96.png');
  return fs.existsSync(a) ? a : b;
}

/* 动画帧目录：桌宠在几个姿势之间缓慢切换，来回都从这里取图。 */
function framesDirUrl() {
  const dir = path.join(ASSET_DIR, 'frames');
  return 'file:///' + dir.replace(/\\/g, '/').replace(/ /g, '%20') + '/';
}

/* 托盘小图标单独出图：16px 下全身动作糊成一团，只能用头部；
   并且按任务栏明暗各配一版，靠描边与底色拉开对比。 */
let _lightBarCache = null;
function detectLightTaskbar() {
  // Windows：任务栏明暗在注册表里，与"应用深色模式"是两套设置，只能查注册表。
  if (process.platform === 'win32') {
    if (_lightBarCache !== null) return _lightBarCache;
    try {
      const out = require('child_process').execSync(
        'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v SystemUsesLightTheme',
        { encoding: 'utf8', windowsHide: true, timeout: 3000 }
      );
      _lightBarCache = /SystemUsesLightTheme\s+REG_DWORD\s+0x1/i.test(out);
    } catch (e) {
      _lightBarCache = false;   // 查不到就按深色任务栏处理（Windows 11 默认）
    }
    dbg('taskbar light = ' + _lightBarCache);
    return _lightBarCache;
  }
  // macOS / Linux：没有等价的注册表项。
  // 早期版本在这里直接 return false，导致永远选白色图标 ——
  // 在 macOS 浅色菜单栏上等于隐形。改用 Electron 自己的主题判断。
  try {
    return !nativeTheme.shouldUseDarkColors;
  } catch (e) {
    return false;
  }
}
function trayIconPath() {
  const style = cfg.trayStyle || 'auto';
  const lightBar = style === 'auto' ? detectLightTaskbar() : style === 'light';
  const p = path.join(ASSET_DIR, lightBar ? 'tray-light.png' : 'tray-dark.png');
  if (fs.existsSync(p)) return p;
  return iconPath();
}
function trayStyleLabel() {
  const s = cfg.trayStyle || 'auto';
  const eff = trayIconPath().indexOf('tray-light') >= 0 ? '浅色版' : '深色版';
  return s === 'auto' ? `托盘图标：自动（现用${eff}）`
       : s === 'light' ? '托盘图标：强制浅色版'
       : '托盘图标：强制深色版';
}

/** 托盘图标：按托盘专用图渲染，未读时叠一个红点 */
function trayIcon(unread) {
  let img = nativeImage.createFromPath(trayIconPath());
  if (img.isEmpty()) img = nativeImage.createEmpty();
  img = img.resize({ width: 16, height: 16 });
  if (!unread) return img;
  // 叠加红点
  const dot = nativeImage.createFromDataURL(
    'data:image/svg+xml;base64,' + Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">' +
      '<circle cx="11.5" cy="11.5" r="4.5" fill="#fb7185" stroke="#0a0c11" stroke-width="1.5"/>' +
      '</svg>'
    ).toString('base64')
  );
  return nativeImage.createEmpty().addRepresentation
    ? mergeImages(img, dot) : img;
}
/** 把 overlay 画在 base 上（16×16 直接用 canvas 不方便，改用简单合成） */
function mergeImages(base, overlay) {
  try {
    const b = base.toBitmap();      // BGRA
    const o = overlay.toBitmap();
    const size = 16 * 16 * 4;
    if (b.length < size || o.length < size) return base;
    for (let i = 0; i < size; i += 4) {
      const a = o[i + 3] / 255;
      if (a <= 0.02) continue;
      b[i]     = Math.round(o[i]     * a + b[i]     * (1 - a)); // B
      b[i + 1] = Math.round(o[i + 1] * a + b[i + 1] * (1 - a)); // G
      b[i + 2] = Math.round(o[i + 2] * a + b[i + 2] * (1 - a)); // R
      b[i + 3] = Math.max(b[i + 3], o[i + 3]);
    }
    return nativeImage.createFromBitmap(b, { width: 16, height: 16 });
  } catch (e) { return base; }
}

/* ───────── 气泡窗口 ───────── */
let bubbleWin = null;
let hideTimer = null;

function createBubbleWindow() {
  const disp = screen.getPrimaryDisplay().workAreaSize;
  const W = 380, H = 560;
  bubbleWin = new BrowserWindow({
    width: W, height: H,
    x: Math.max(0, disp.width - W - 24),
    y: Math.max(0, disp.height - H - 24),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  bubbleWin.loadFile(path.join(__dirname, 'bubble.html'));
  /* 就绪标志：不要用 webContents.isLoading() 判断——
     在 did-finish-load 事件派发期间它仍可能返回 true，此时再注册一个
     once('did-finish-load') 就永远不会触发，消息被永久挂起。 */
  bubbleWin.__ready = false;
  bubbleWin.__pending = null;
  bubbleWin.webContents.on('did-finish-load', () => {
    bubbleWin.__ready = true;
    dbg('renderer ready');
    if (bubbleWin.__pending) { const q = bubbleWin.__pending; bubbleWin.__pending = null; q(); }
  });
  bubbleWin.on('closed', () => { bubbleWin = null; });
  return bubbleWin;
}

/** 渲染进程就绪后执行 fn（已就绪则立即执行，两种竞态都安全） */
function whenReady(win, fn) {
  if (win.__ready) { fn(); return; }
  win.__pending = fn;
}

function ensureBubble() {
  if (!bubbleWin || bubbleWin.isDestroyed()) createBubbleWindow();
  return bubbleWin;
}

/** 显示气泡：把这一期的数据推给渲染进程 */
function showIssue(issue, opts) {
  opts = opts || {};
  const win = ensureBubble();
  const payload = {
    issue: {
      id: issue.id,
      range: issue.range,
      kicker: issue.kicker || '',
      msg: issue.msg || '',
      size: issue.size || '',
      file: path.basename(String(issue.file || '')),
      absPath: issuesLib.absoluteIssuePath(issue),
      exists: issuesLib.issueFileExists(issue),
      erratum: issue.erratum || {},
      errataIntro: issue.errataIntro || ''
    },
    autoHideMs: opts.autoHideMs != null ? opts.autoHideMs : cfg.autoHideMs,
    avatarUrl: avatarFileUrl(),
    unread: st.unread
  };
  const send = () => {
    if (win.isDestroyed()) { dbg('send: win destroyed'); return; }
    try {
      // 关键：payload 里的对象来自 vm 沙箱（另一个 realm），某些版本的结构化克隆
      // 会拒绝它。这里先做一次 JSON 往返，转成本 realm 的纯对象，最稳。
      const plain = JSON.parse(JSON.stringify(payload));
      win.webContents.send('issue', plain);
      dbg('send: ok, keys=' + Object.keys(plain).join('/'));
    } catch (e) {
      dbg('send: THREW ' + e.message);
    }
    win.showInactive();
    win.setAlwaysOnTop(true, 'screen-saver');
    if (process.platform === 'win32') win.setSkipTaskbar(true);
  };
  if (win.webContents.isLoading() && !win.__ready) whenReady(win, send);
  else send();

  st.lastShown = new Date().toISOString();
  saveSt();
  armHideTimer(payload.autoHideMs);
  refreshTray();
}

function armHideTimer(ms) {
  clearTimeout(hideTimer);
  if (!ms || ms <= 0) return;
  hideTimer = setTimeout(() => hideBubble('timeout'), ms);
}

/** 收起气泡；reason='timeout' 时记一次未读 */
function hideBubble(reason) {
  clearTimeout(hideTimer);
  if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.hide();
  if (reason === 'timeout' && st.lastShown) {
    const id = (st.delivered[st.delivered.length - 1] || st.lastShown);
    if (st.seen.indexOf(id) < 0) {
      st.unread = (st.unread || 0) + 1;
      saveSt();
      refreshTray();
    }
  }
}

/* ───────── 桌宠窗口（真正的"桌宠"）─────────
   托盘图标在时钟旁边，不算"桌面上的桌宠"。这里再开一个无边框透明、
   始终置顶、不占任务栏的小窗口，把角色摆在桌面上，可拖动。 */
let petWin = null;
const PET_W = 116, PET_H = 140;   // 角色 104 + 间距 + 工具栏 26 + 内边距

function petPos() {
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const p = st.pos;
  if (p && typeof p.left === 'number' && typeof p.top === 'number') {
    return {
      x: Math.max(0, Math.min(p.left, wa.width - PET_W)),
      y: Math.max(0, Math.min(p.top, wa.height - PET_H))
    };
  }
  return { x: Math.max(0, wa.width - PET_W - 36), y: Math.max(0, wa.height - PET_H - 24) };
}

function createPetWindow() {
  const pos = petPos();
  petWin = new BrowserWindow({
    width: PET_W, height: PET_H,
    x: pos.x, y: pos.y,
    frame: false, transparent: true, resizable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
    maximizable: false, minimizable: false, fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  petWin.loadFile(path.join(__dirname, 'pet.html'));
  petWin.__ready = false;
  petWin.webContents.on('did-finish-load', () => {
    petWin.__ready = true;
    petWin.webContents.send('assets', assetsPayload());
    petWin.webContents.send('unread', st.unread || 0);
    petWin.showInactive();
  });
  // 记住拖动后的位置（原生拖动区不会发 move 事件之外的东西，用 move 节流保存）
  let saveT = null;
  petWin.on('move', () => {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      if (!petWin || petWin.isDestroyed()) return;
      const b = petWin.getBounds();
      st.pos = { left: b.x, top: b.y };
      saveSt();
    }, 400);
  });
  petWin.on('closed', () => { petWin = null; });
  return petWin;
}

function showPet(show) {
  if (show) {
    if (!petWin || petWin.isDestroyed()) createPetWindow();
    else { petWin.showInactive(); }
  } else if (petWin && !petWin.isDestroyed()) {
    petWin.close();
  }
}
function pushToPet(channel, payload) {
  if (petWin && !petWin.isDestroyed() && petWin.__ready) {
    petWin.webContents.send(channel, payload);
  }
}

/* ───────── 托盘 ───────── */
let tray = null;
let nextTimer = null;

function fmtDT(d) {
  const p = n => (n < 10 ? '0' : '') + n;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function until(ms) {
  if (ms <= 0) return '即将投递';
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400); let r = s - d * 86400;
  const h = Math.floor(r / 3600); r -= h * 3600;
  const m = Math.floor(r / 60);
  if (d > 0) return `${d} 天 ${h} 小时后`;
  if (h > 0) return `${h} 小时 ${m} 分钟后`;
  if (m > 0) return `${m} 分钟后`;
  return `${r} 秒后`;
}

function refreshTray() {
  if (!tray) return;
  const nd = issuesLib.nextDelivery(cfg);
  const lines = [
    '全球一周速览',
    `下一次：${fmtDT(nd)}（${until(nd - Date.now())}）`,
    st.unread > 0 ? `未读：${st.unread} 期` : '未读：无'
  ];
  tray.setToolTip(lines.join('\n'));
  tray.setImage(trayIcon(st.unread > 0));
  tray.setContextMenu(Menu.buildFromTemplate(buildMenu(nd)));
  pushToPet('unread', st.unread || 0);   // 同步桌宠上的红点
}

function buildMenu(nd) {
  const r = issuesLib.loadIssuesFromPet();
  const list = (r.list || []).slice().reverse();
  const items = list.slice(0, 12).map(it => ({
    label: `${it.range}  ${it.kicker || ''}`.trim(),
    click: () => openIssue(it)
  }));
  return [
    { label: `下一次投递：${fmtDT(nd)}`, enabled: false },
    { label: until(nd - Date.now()) + '后自动弹出', enabled: false },
    { type: 'separator' },
    { label: '📄 打开最新一期', click: () => {
        const latest = (r.list || [])[0];
        if (latest) openIssue(latest); else notify('还没有任何期数');
      } },
    { label: '🐋 立即弹一次气泡（预览）', click: () => {
        const latest = (r.list || [])[0];
        if (latest) showIssue(latest, { autoHideMs: 15000 });
        else notify('还没有任何期数');
      } },
    { type: 'separator' },
    { label: `期数清单（${list.length} 期）`, enabled: false },
    ...items,
    { type: 'separator' },
    { label: `投递时间：周${'日一二三四五六'[cfg.weekday]} ${String(cfg.hour).padStart(2, '0')}:${String(cfg.minute).padStart(2, '0')}`, enabled: false },
    { label: '📂 打开 issues 文件夹', click: () => shell.openPath(issuesLib.ISSUES_DIR) },
    { label: '📂 打开项目文件夹', click: () => shell.openPath(PET_DIR) },
    { type: 'separator' },
    { label: '显示桌宠', type: 'checkbox', checked: cfg.showPet !== false, click: (mi) => {
        cfg.showPet = mi.checked; saveCfg(); showPet(mi.checked); refreshTray();
      } },
    { label: '开机自启', type: 'checkbox', checked: !!cfg.autostart, click: (mi) => {
        cfg.autostart = mi.checked; saveCfg(); applyAutostart(); refreshTray();
      } },
    { label: '待机动作（姿势缓慢切换）', type: 'checkbox', checked: cfg.idleAnim !== false, click: (mi) => {
        cfg.idleAnim = mi.checked; saveCfg();
        if (petWin && !petWin.isDestroyed()) {
          petWin.webContents.send('assets', assetsPayload());
        }
        refreshTray();
      } },
    { type: 'separator' },
    { label: trayStyleLabel(), enabled: false },
    { label: '托盘图标：自动（跟随任务栏）', type: 'radio',
      checked: (cfg.trayStyle || 'auto') === 'auto',
      click: () => { cfg.trayStyle = 'auto'; _lightBarCache = null; saveCfg(); refreshTray(); } },
    { label: '托盘图标：白色描边（配深色任务栏）', type: 'radio',
      checked: cfg.trayStyle === 'dark',
      click: () => { cfg.trayStyle = 'dark'; saveCfg(); refreshTray(); } },
    { label: '托盘图标：深色描边（配浅色任务栏）', type: 'radio',
      checked: cfg.trayStyle === 'light',
      click: () => { cfg.trayStyle = 'light'; saveCfg(); refreshTray(); } },
    { label: '↻ 重新检测任务栏配色', click: () => {
        _lightBarCache = null;
        notify('已重新检测：' + (detectLightTaskbar() ? '浅色任务栏' : '深色任务栏'));
        refreshTray();
      } },
    { type: 'separator' },
    { label: st.unread > 0 ? `清除未读红点（${st.unread}）` : '清除未读红点', enabled: st.unread > 0, click: () => {
        st.unread = 0; saveSt(); refreshTray();
      } },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
  ];
}

function avatarFileUrl() {
  return 'file:///' + iconPath().replace(/\\/g, '/').replace(/ /g, '%20');
}
/* 桌宠窗口需要知道去哪里取动画帧，以及是否播放待机动作 */
function assetsPayload() {
  return { dir: framesDirUrl(), idleAnim: cfg.idleAnim !== false };
}

function notify(body, title) {
  try {
    if (Notification.isSupported()) {
      new Notification({ title: title || '全球一周速览', body }).show();
    }
  } catch (e) {}
}

/** 打开一期：用系统默认浏览器打开（不占用托盘窗口） */
function openIssue(issue) {
  const p = issuesLib.absoluteIssuePath(issue);
  if (!fs.existsSync(p)) { notify(`文件不存在：\n${p}`); return; }
  // 标记已读
  if (st.seen.indexOf(issue.id) < 0) st.seen.push(issue.id);
  st.unread = 0; saveSt();
  hideBubble('opened');
  refreshTray();
  shell.openPath(p).then(err => { if (err) notify('打不开：' + err); });
}

/* ───────── 定时投递 ───────── */
let lastTick = 0;
function tick() {
  const now = new Date();
  lastTick = now.getTime();
  const due = issuesLib.dueIssues(cfg, st.delivered, now);
  if (due.length) {
    // 一次只弹最新的一期；更早的记进列表里，菜单可见
    const latest = due[due.length - 1];
    due.forEach(it => { if (st.delivered.indexOf(it.id) < 0) st.delivered.push(it.id); });
    saveSt();
    showIssue(latest);
    notify(`新的一期：${latest.range}`, '全球一周速览');
    if (due.length > 1) notify(`另有 ${due.length - 1} 期也已到投递时间，右键托盘查看`);
    scheduleNext();
  }
  refreshTray();
}

/** 用 setTimeout 精确对准下一次投递时刻，同时保留 30 秒兜底轮询（防休眠错过） */
function scheduleNext() {
  clearTimeout(nextTimer);
  const nd = issuesLib.nextDelivery(cfg);
  const delay = Math.max(1000, Math.min(nd - Date.now(), 2147483000));
  nextTimer = setTimeout(() => { tick(); scheduleNext(); }, delay + 1500);
}

function applyAutostart() {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!cfg.autostart,
      path: process.execPath,
      args: app.isPackaged ? [] : [path.resolve(__dirname)]
    });
  } catch (e) { console.error('[weeklypet] 设置自启失败', e.message); }
}

/* ───────── IPC ───────── */
ipcMain.on('open-issue', (_e, absPath) => {
  if (typeof absPath === 'string' && fs.existsSync(absPath)) {
    const id = (issuesLib.loadIssuesFromPet().list || [])
      .find(i => issuesLib.absoluteIssuePath(i) === absPath);
    if (id) { openIssue(id); return; }
    shell.openPath(absPath);
  } else {
    notify('文件不存在');
  }
});
ipcMain.on('collapse', () => hideBubble('manual'));
ipcMain.on('keep-open', () => clearTimeout(hideTimer));   // 鼠标悬停时不要收
ipcMain.on('rearm', (_e, ms) => armHideTimer(ms));

/* 桌宠窗口的三个动作 */
ipcMain.on('pet:show-bubble', () => {
  const latest = (issuesLib.loadIssuesFromPet().list || [])[0];
  if (latest) showIssue(latest);
  else notify('还没有任何期数');
});
ipcMain.on('pet:open-latest', () => {
  const latest = (issuesLib.loadIssuesFromPet().list || [])[0];
  if (latest) openIssue(latest);
  else notify('还没有任何期数');
});
ipcMain.on('pet:popup-menu', () => {
  if (!tray) return;
  const nd = issuesLib.nextDelivery(cfg);
  tray.popUpContextMenu(Menu.buildFromTemplate(buildMenu(nd)));
});

/* ───────── 自检模式：不建窗口，只跑逻辑并打印结果 ───────── */
function selftest() {
  const out = [];
  const ok = (c, label, detail) => out.push(`${c ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  const r = issuesLib.loadIssuesFromPet();
  ok(!!r.list, '从 ../index.html 读到 ISSUES', r.error || `共 ${r.list.length} 期`);
  if (r.list) {
    r.list.forEach(it => {
      ok(!!issuesLib.plannedAt(it, cfg), `plannedAt("${it.range}")`,
        String(issuesLib.plannedAt(it, cfg)));
      ok(issuesLib.issueFileExists(it), `文件存在 ${it.file}`);
    });
  }
  const nd = issuesLib.nextDelivery(cfg);
  ok(nd > new Date(), 'nextDelivery 在未来', fmtDT(nd));
  ok(!!trayIcon(false), '托盘图标可生成', trayIconPath());
  ok(!!trayIcon(true), '未读图标可生成', '红点叠加');
  out.push(`INFO  任务栏配色检测：${detectLightTaskbar() ? '浅色' : '深色'}  托盘图标样式：${cfg.trayStyle || 'auto'}`);
  out.push(`INFO  托盘图标实际文件：${path.basename(trayIconPath())}`);
  const due = issuesLib.dueIssues(cfg, [], new Date());
  out.push(`INFO  以"什么都没投递过"计算，当前已到点的期数：${due.length}`);
  out.push(`INFO  桌宠主体图：${path.basename(iconPath())}`);
  const fdir = path.join(ASSET_DIR, 'frames');
  let nFrames = 0;
  try { nFrames = fs.readdirSync(fdir).filter(f => /\.png$/i.test(f)).length; } catch (e) {}
  out.push(`INFO  待机动画帧：${nFrames} 张（assets/frames/），待机动作=${cfg.idleAnim !== false ? '开' : '关'}`);
  out.push(`INFO  项目目录：${PET_DIR}`);
  out.push(`INFO  期数清单来源：${issuesLib.PET_HTML}`);
  const text = out.join('\n');
  // Electron 在 Windows 上不往父控制台写 stdout（GUI 程序脱离控制台），
  // 所以同时落盘一份，便于命令行验证。
  try {
    fs.writeFileSync(path.join(__dirname, 'selftest.txt'), text + '\n', 'utf8');
  } catch (e) {}
  console.log(text);
}

/* ───────── 启动 ───────── */
// 单实例：第二次启动就唤出气泡，而不是再开一个托盘
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const r = issuesLib.loadIssuesFromPet();
    if (r.list && r.list[0]) showIssue(r.list[0], { autoHideMs: 15000 });
  });

  app.whenReady().then(() => {
    stateFile = path.join(app.getPath('userData'), 'state.json');
    cfgFile = path.join(app.getPath('userData'), 'config.json');
    cfg = { ...DEFAULT_CFG, ...loadJSON(cfgFile, DEFAULT_CFG) };
    st = { delivered: [], unread: 0, lastShown: null, seen: [], ...loadJSON(stateFile, st) };
    // 首次运行就把配置文件落盘，方便你直接在 %APPDATA%\weeklypet-tray\ 里查看/修改
    if (!fs.existsSync(cfgFile)) saveCfg();
    if (!fs.existsSync(stateFile)) saveSt();

    if (process.argv.includes('--selftest')) { selftest(); app.exit(0); return; }

    // --shot=<path>：起一个真实窗口，截图后退出。用于自动化验证渲染效果。
    const shotArg = process.argv.find(a => a.startsWith('--shot='));
    if (shotArg) {
      const outFile = shotArg.slice('--shot='.length);
      const r = issuesLib.loadIssuesFromPet();
      const it = r.list && r.list[0];
      if (!it) { console.error('没有期数可展示'); app.exit(1); return; }
      const win = ensureBubble();
      const grab = () => {
        // 先把渲染进程的报错抓出来，否则白屏无从判断
        const errs = [];
        win.webContents.on('console-message', (e) => {
          const lvl = e && e.level != null ? e.level : '';
          const msg = e && e.message != null ? e.message : String(e);
          errs.push(`[console:${lvl}] ${msg}`);
        });
        showIssue(it, { autoHideMs: 0 });
        setTimeout(async () => {
          try {
            const dom = await win.webContents.executeJavaScript(`(() => {
              const c = document.querySelector('#card');
              const t = document.querySelector('#tag');
              const f = document.querySelector('#fileT');
              const m = document.querySelector('#msg');
              return {
                hasPet: typeof window.pet,
                petKeys: window.pet ? Object.keys(window.pet).join(',') : '',
                listeners: window.__petListeners || 0,
                lastPayload: window.__lastPayload || null,
                cardClass: c ? c.className : 'NO #card',
                cardRect: c ? JSON.stringify(c.getBoundingClientRect()) : '',
                tag: t ? t.textContent : '',
                file: f ? f.textContent : '',
                msgLen: m ? m.textContent.length : 0,
                avatarSrc: (document.querySelector('#avatar')||{}).src || '',
                bodyText: document.body ? document.body.innerText.slice(0, 200) : ''
              };
            })()`);
            fs.writeFileSync(outFile.replace(/\.png$/, '.json'), JSON.stringify({ dom, errs }, null, 2), 'utf8');
            const img = await win.webContents.capturePage();
            fs.writeFileSync(outFile, img.toPNG());
            console.log('已写出截图 ' + outFile);
          } catch (e) {
            console.error('截图失败: ' + e.message);
          }
          app.exit(0);
        }, 1800);
      };
      if (win.webContents.isLoading() && !win.__ready) whenReady(win, grab);
      else grab();
      return;
    }

    // --shot-pet=<path>：抓桌宠窗口，用于确认它不是空白的
    const shotPetArg = process.argv.find(a => a.startsWith('--shot-pet='));
    if (shotPetArg) {
      const outFile = shotPetArg.slice('--shot-pet='.length);
      if (process.platform === 'win32') app.setAppUserModelId('com.weeklypet.tray');
      tray = new Tray(trayIcon(false));
      refreshTray();
      showPet(true);
      setTimeout(async () => {
        try {
          const dom = await petWin.webContents.executeJavaScript(`(() => {
            const front = document.querySelector('#stage img:not([aria-hidden])') ||
                          document.querySelector('#stage img');
            return {
              petSrc: (front && front.src) || '',
              petComplete: front ? front.complete : null,
              petNaturalW: front ? front.naturalWidth : null,
              petVisible: front ? getComputedStyle(front).visibility : null,
              petRect: front ? JSON.stringify(front.getBoundingClientRect()) : '',
              bodyText: document.body.innerText,
              rect: JSON.stringify({w: innerWidth, h: innerHeight})
            };
          })()`);
          fs.writeFileSync(outFile.replace(/\.png$/, '.json'), JSON.stringify(dom, null, 2), 'utf8');
          const img = await petWin.webContents.capturePage();
          fs.writeFileSync(outFile, img.toPNG());
          console.log('已写出桌宠截图 ' + outFile);
        } catch (e) { console.error('截图失败: ' + e.message); }
        app.exit(0);
      }, 1800);
      return;
    }

    if (process.platform === 'win32') app.setAppUserModelId('com.weeklypet.tray');

    tray = new Tray(trayIcon(false));
    tray.on('click', () => {
      const r = issuesLib.loadIssuesFromPet();
      if (r.list && r.list[0]) showIssue(r.list[0]);
    });
    tray.on('double-click', () => {
      const r = issuesLib.loadIssuesFromPet();
      if (r.list && r.list[0]) openIssue(r.list[0]);
    });
    refreshTray();
    scheduleNext();
    showPet(cfg.showPet !== false);        // 桌宠：默认显示

    // 兜底轮询 + 休眠唤醒后补投
    setInterval(tick, 30000);
    powerMonitor.on('resume', () => { tick(); scheduleNext(); showPet(cfg.showPet !== false); });

    if (process.argv.includes('--preview')) {
      const r = issuesLib.loadIssuesFromPet();
      if (r.list && r.list[0]) showIssue(r.list[0], { autoHideMs: 0 });
    }
  });

  app.on('window-all-closed', (e) => { /* 托盘常驻，不退出 */ });
}
