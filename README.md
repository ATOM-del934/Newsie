# 🐋 全球一周速览 · 桌宠

> 一只常驻桌面的鲸鱼。每周日 20:00，它把「全球一周速览」推到你面前。
>
> **零后端、零服务器、零账号** —— 内容是你自己的 HTML 文件，它只负责按时端上来。

<p align="center">
  <img src="docs/preview-pet.png" width="130" alt="桌面鲸鱼">&nbsp;&nbsp;&nbsp;
  <img src="docs/preview-popup.png" width="300" alt="投递气泡">
</p>

**English** · A desktop pet that delivers a weekly news digest as a local HTML file
every Sunday at 20:00. Two builds: a zero-install web page, and an Electron tray app
that keeps working after you close the window. No server, no account, no network calls.
Jump to the [English summary](#english-summary).

左边的鲸鱼常驻桌面，可拖动；右边的气泡就是每周日 20:00 弹出来的东西 ——
一句话摘要、可直接打开的速览文件，以及**对上一期的复核结果**。

---

## 两个版本，二选一

| | 网页版 | 托盘版 |
|:--|:--|:--|
| 入口 | `index.html`（双击） | `electron-tray/启动.cmd`（Windows）<br>`pnpm start`（macOS / Linux） |
| 安装 | **不用装任何东西** | 需要 Electron（约 230 MB） |
| 关掉之后 | ❌ 不再推送，下次打开补投 | ✅ **照样准点推送** |
| 桌面鲸鱼 | ✅ 可拖动 | ✅ 可拖动 |
| 系统通知 | 浏览器通知 | ✅ 原生通知 |
| 未读红点 | 页面内 📬 | ✅ 叠在托盘图标上 |
| 开机自启 | — | ✅ 菜单里勾选 |
| 适合 | 先试试看 | 长期常驻 |

**建议先开网页版**，10 秒就能看到效果；确定要长期用了再装托盘版。

---

## 快速开始

### 网页版

双击 `index.html`。就这样。

桌面右下角会出现一只可拖动的鲸鱼。点它身上的 **📬** 看最新一期，
**📄** 用浏览器打开，**⋯** 打开设置。

### 托盘版

需要先装 [Node.js](https://nodejs.org/)（自带 `npm`）与 [pnpm](https://pnpm.io/)。
用 `npm` 也行，把下面的 `pnpm` 换成 `npm` 即可。

```bash
cd electron-tray
pnpm install      # 首次会下载 Electron，约 230 MB
pnpm start
```

**Windows** 也可以直接双击 `electron-tray/启动.cmd`。

启动后：

- **左键单击**托盘图标 → 弹出最新一期
- **左键双击** → 用浏览器打开
- **右键** → 菜单（下一次投递时间、预览气泡、开机自启、切换头像、清除红点…）

### 如果 Electron 下载卡住

GitHub Releases 在国内经常连不上。`electron-tray/.npmrc` 已经配好国内镜像：

```
electron_mirror=https://npmmirror.com/mirrors/electron/
```

仍然失败就手动补跑一次：

```bash
node node_modules/electron/install.js
```

---

## 它怎么工作

```
index.html                    ← 桌宠本体 + 期数清单（ISSUES 数组）
issues/
  └── 全球一周速览-*.html      ← 每一期就是一份普通 HTML
```

**投递时刻怎么算**：每期在清单里写一个覆盖区间，例如 `range: '2026.10.04 – 10.10'`，
程序取**区间结束日所在那一周的周日 20:00** 投递。

**时区**：按你电脑的本地时间，不做时区换算。你机器上显示几点就是几点。

**错过会补投**：到点时程序没在跑，下次启动会立刻把落下的期数补上，
并在气泡里提示还有几期积压。**内容不会丢，只是晚到。**

---

## 每周换一期内容

1. 把新一期的 HTML 放进 `issues/`
2. 打开 `index.html`，在 `ISSUES` 数组**最前面**插一条记录
3. 完成 —— 两个版本共用这一份清单，改一处两边都生效

字段说明、完整代码模板、以及**排版规格 + 硬性约束**都写在
[`issues/_模板-新一期.md`](issues/_模板-新一期.md) 里。

清单里还有一块 `erratum`（勘误）：投递新一期时，气泡会附上**对上一期的复核结果**
—— 上一期哪里写错了、漏了什么。这部分需要人来判断（本质是事实核查），程序只负责展示。

### 期长什么样

附带的示例期用的是**报纸头版式排版**：报头、四栏网格、短报道各自成块不跨栏、
每个分区一条主色顶线、关键数字用红色标出。完整规格见
[`issues/_模板-新一期.md`](issues/_模板-新一期.md)。

![周报预览](docs/preview-report.png)

---

## 常见问题

**Q：托盘上看不到图标？**
Windows 11 默认把新托盘图标折叠进 **`^`** 溢出区。点一下那个小箭头，
或到「设置 → 个性化 → 任务栏 → 其他系统托盘图标」里把它打开。**这不是程序问题。**

**Q：启动时报 `Cannot read properties of undefined (reading 'on')`？**
你的环境里设了 `ELECTRON_RUN_AS_NODE`。这个变量会让 Electron 退化成纯 Node，
于是 `require('electron')` 只返回一个路径字符串，`ipcMain` / `Tray` 全是 `undefined`。

```bash
# Windows (cmd)
set ELECTRON_RUN_AS_NODE=
# macOS / Linux
unset ELECTRON_RUN_AS_NODE
```

`启动.cmd` 已经自动处理了这一条。

**Q：点了没反应 / 气泡不出现？**
程序只在**到点**时才主动弹气泡。想立刻看效果，右键托盘图标 →「立即弹一次气泡（预览）」。

**Q：数据存在哪？**

| 系统 | 路径 |
|:--|:--|
| Windows | `%APPDATA%\weeklypet-tray\` |
| macOS | `~/Library/Application Support/weeklypet-tray/` |
| Linux | `~/.config/weeklypet-tray/` |

里面是 `config.json`（投递时间、头像、自启）和 `state.json`（已投递 / 未读）。
**删掉等于恢复出厂设置** —— 已投递记录清空，下次启动会把到点的期数重投一遍。

**Q：怎么改投递时间？**
改上面那份 `config.json` 的 `weekday` / `hour` / `minute`（`weekday` 里 0 = 周日），
重启程序生效。

> ⚠️ 用记事本或 PowerShell 存 UTF-8 会写入 **BOM**，会让配置被静默忽略。
> 程序已做兼容（读的时候会剥掉 BOM），但建议用 VS Code 这类不写 BOM 的编辑器。

---

## 已知限制

- **托盘版不含 `node_modules`**（约 230 MB），首次使用要自己 `pnpm install`。
- **macOS / Linux 上托盘图标的深/浅色是尽力推断**：Windows 能读注册表准确判断任务栏明暗，
  其他平台用 Electron 的主题状态推断，个别桌面环境可能选错。菜单里可以手动强制。
- **网页版关掉页面就不会推送** —— 浏览器限制。要"关掉也准点"请用托盘版。
- **只在 Windows 11 上做过完整实机验证**。macOS / Linux 的代码路径有，但没有实机跑过。

---

## 目录结构

```
.
├── index.html                 H5 桌宠（零依赖，双击可用）
├── whale-official.png         头像：带底板原图
├── whale-ink.png              头像：透明底
├── whale-ink-96.png           头像：透明底 96px
├── issues/
│   ├── 全球一周速览-2026-10-04_10.html   示例期（报纸头版排版）
│   └── _模板-新一期.md                    新一期模板 + 排版规格
├── electron-tray/             Electron 托盘版
│   ├── 启动.cmd               Windows 入口
│   ├── main.js                托盘 / 定时 / 气泡窗口 / 桌面鲸鱼
│   ├── bubble.html            气泡界面
│   ├── pet.html               桌面鲸鱼窗口
│   ├── preload.js             安全桥
│   ├── issues.js              读取期数清单 + 投递时刻推算
│   ├── assets/                图标
│   └── README.md              托盘版详细说明（含开发记录）
└── docs/                      README 用图
```

---

## 关于图标（待替换）

⚠️ **本仓库当前的鲸鱼图标是作者自用版本的占位素材，公开发布前请先替换。**

替换方法：把自己的图标覆盖到这些位置即可，尺寸与格式不拘，只要同名。

```
whale-official.png                     ← 桌宠主头像（带底板）
whale-ink.png / whale-ink-96.png       ← 透明底版本
electron-tray/assets/whale-*.png       ← 托盘版用
electron-tray/assets/tray-*.png        ← 托盘小图标（深/浅任务栏各一）
```

替换后记得重新生成 README 里的预览图（见 `docs/`）。

本项目是**个人作品，与 DeepSeek 无任何关系**，未获其授权、背书或赞助；
请勿在发布时使用他人的品牌标识。

---

## License

[MIT](LICENSE) © 2026 Lurongsen

---

<a id="english-summary"></a>
## English summary

A desktop pet that delivers your own weekly news digest as a **local HTML file**
every Sunday at 20:00. No server, no account, no network access.

**Two builds**

- **Web** — open `index.html`. No install, no dependencies. The pet floats on the page
  and can only deliver while the page is open.
- **Electron tray** — `cd electron-tray && pnpm install && pnpm start`. Lives in the
  system tray, keeps delivering after you close everything, shows a native
  notification, and puts an unread dot on the tray icon.

**Scheduling** — each issue declares a date range; the app delivers it on the Sunday at
20:00 of the week containing the range's end date, in **local time**. Missed deliveries
are caught up on the next launch, never dropped.

**Adding an issue** — drop an HTML file into `issues/`, then prepend one record to the
`ISSUES` array in `index.html`. Both builds read that single manifest.

**Layout spec** — see `issues/_模板-新一期.md` (Chinese). The bundled sample issue uses a
newspaper front-page layout: masthead, a four-column grid, a multi-column flow that
keeps each short report unbroken, per-section colour rules, and a handful of red
emphasis marks.

**State** lives in the per-user config directory (`%APPDATA%\weeklypet-tray` on Windows,
`~/Library/Application Support/weeklypet-tray` on macOS, `~/.config/weeklypet-tray`
on Linux).

**Status** — fully tested on Windows 11 only; the macOS/Linux code paths exist but have
not run on real hardware.

MIT licensed. Not affiliated with, endorsed by, or sponsored by DeepSeek.

> **Note on artwork:** the whale icons currently in this repository are placeholders from
> the author's personal build and **must be replaced with your own artwork before you
> publish a fork**. See the icon section above for the file paths.
