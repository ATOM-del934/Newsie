/* ══════════════════════════════════════════════════════════════════
   issues.js — 期数清单加载器

   设计决定：**清单只有一份**，就是桌宠 ../index.html 里的 ISSUES 数组。
   本模块把它抽出来求值，避免"加一期要改两个文件"这种维护陷阱。

   为什么能这么做：那个数组是用 `var ISSUES = [ ... ];` 声明的、格式固定，
   且内容是我们自己的数据（不是第三方输入）。求值范围仅限该字面量，
   用 vm 在一个空沙箱里跑，拿不到 require / process / global。
   ══════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* 内容根目录：index.html / issues / assets 所在的那一层。
   开发时是 electron-tray 的上级目录；打包后 packager 用 --extra-resource
   把这些内容放进 resources/，由 main.js 调 setBaseDir() 指过去。
   这里刻意不 require('electron')，保持本模块是纯 Node，可独立测试。 */
let BASE = path.resolve(__dirname, '..');
function setBaseDir(dir) { if (dir) BASE = dir; }
function baseDir() { return BASE; }
function petHtmlPath() { return path.join(BASE, 'index.html'); }
function issuesDirPath() { return path.join(BASE, 'issues'); }

/** 从桌宠 index.html 里抽出 ISSUES 字面量；失败返回 null */
function loadIssuesFromPet() {
  let html;
  try {
    html = fs.readFileSync(petHtmlPath(), 'utf8');
  } catch (e) {
    return { error: `读不到 ${petHtmlPath()}：${e.message}` };
  }
  // 匹配 var ISSUES = [ ... ];  —— 数组里不可能出现 "];" 这种序列
  const m = html.match(/var\s+ISSUES\s*=\s*(\[[\s\S]*?\n\s*\];)/);
  if (!m) return { error: '在 index.html 里没找到 `var ISSUES = [ ... ];`' };

  try {
    const sandbox = Object.create(null);
    const list = vm.runInNewContext('(' + m[1].replace(/;\s*$/, '') + ')', sandbox, {
      timeout: 2000,
      filename: 'ISSUES-literal'
    });
    if (!Array.isArray(list)) return { error: 'ISSUES 不是数组' };
    return { list };
  } catch (e) {
    return { error: `解析 ISSUES 失败：${e.message}` };
  }
}

/** 把 file 字段（相对内容根目录的路径）解析成绝对路径 */
function absoluteIssuePath(issue) {
  return path.resolve(BASE, issue.file);
}

/**
 * 计算一期的计划投递时刻：该期 range 结束日所在那一周的「配置星期 + 时刻」。
 * 与桌宠里的 plannedAt() 保持完全一致——两边必须算出同一个时间。
 */
function endDate(range) {
  const m = String(range || '').match(
    /(\d{4})\.(\d{2})\.(\d{2})\s*[–\-—~至]\s*(?:(\d{4})\.)?(\d{2})\.(\d{2})/
  );
  if (!m) return null;
  const y = m[4] ? +m[4] : +m[1];          // 跨年区间要用后一个年份
  return new Date(y, +m[5] - 1, +m[6], 0, 0, 0, 0);
}

function plannedAt(issue, cfg) {
  const end = endDate(issue.range);
  if (end) {
    const add = (cfg.weekday - end.getDay() + 7) % 7;
    return new Date(end.getFullYear(), end.getMonth(), end.getDate() + add,
                    cfg.hour, cfg.minute, 0, 0);
  }
  if (issue.deliveredAt) {
    const f = new Date(issue.deliveredAt);
    if (!isNaN(f.getTime())) return f;
  }
  return null;
}

/** 下一次投递时刻（用于菜单里显示倒计时） */
function nextDelivery(cfg, from) {
  const now = from || new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
                     cfg.hour, cfg.minute, 0, 0);
  d.setDate(d.getDate() + ((cfg.weekday - d.getDay() + 7) % 7));
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 7);
  return d;
}

/** 已到点但尚未投递的期数，按计划时刻升序 */
function dueIssues(cfg, deliveredIds, now) {
  const t = (now || new Date()).getTime();
  const r = loadIssuesFromPet();
  if (!r.list) return [];
  return r.list
    .map(it => ({ it, at: plannedAt(it, cfg) }))
    .filter(x => x.at && x.at.getTime() <= t && deliveredIds.indexOf(x.it.id) < 0)
    .sort((a, b) => a.at - b.at)
    .map(x => x.it);
}

/** 文件存在性检查（投递前确认 HTML 真的在） */
function issueFileExists(issue) {
  try { return fs.existsSync(absoluteIssuePath(issue)); } catch (e) { return false; }
}

function listIssueFiles() {
  try { return fs.readdirSync(issuesDirPath()); } catch (e) { return []; }
}

module.exports = {
  /* 这三个用 getter 而不是普通属性：setBaseDir() 之后调用方读到的必须是最新值，
     否则菜单里「打开 issues 文件夹」会指向开发时的旧路径。 */
  get PET_DIR() { return BASE; },
  get PET_HTML() { return petHtmlPath(); },
  get ISSUES_DIR() { return issuesDirPath(); },
  setBaseDir, baseDir,
  loadIssuesFromPet, absoluteIssuePath, endDate, plannedAt, nextDelivery,
  dueIssues, issueFileExists, listIssueFiles
};
