/* 确保 Electron 的运行时二进制存在。
 *
 * 为什么需要它：pnpm 10+ 出于安全考虑，默认**不执行依赖的构建脚本**。
 * 而 electron 这个包只装壳 —— 真正的运行时（electron.exe / Electron.app）
 * 是靠它自己的 postinstall 下载的。被拦掉的话：
 *
 *     node_modules/electron/dist/electron.exe 不存在
 *     pnpm start  →  The system cannot find the file specified
 *
 * 现象很迷惑：`pnpm install` 显示成功，却跑不起来。
 *
 * 项目**自身**的 postinstall 不受那条策略限制，所以在这里补这一步。
 * 已经有二进制就直接跳过，不会每次重复下载。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const electronPkg = path.join(__dirname, '..', 'node_modules', 'electron');
const installer = path.join(electronPkg, 'install.js');
const marker = path.join(electronPkg, 'dist', 'electron' +
  (process.platform === 'win32' ? '.exe' : ''));

if (fs.existsSync(marker)) process.exit(0);          // 已经就位

if (!fs.existsSync(installer)) {
  // 依赖还没装（比如在空目录里跑了 postinstall），不是错误
  console.warn('[postinstall] 尚未安装 electron，跳过运行时检查');
  process.exit(0);
}

console.log('[postinstall] Electron 运行时缺失，正在补下载…');
try {
  require('child_process').execFileSync(process.execPath, [installer], { stdio: 'inherit' });
  console.log('[postinstall] 完成');
} catch (e) {
  // 不中断安装，但必须把补救办法说清楚，否则用户只会看到「装了却跑不起来」
  console.warn('');
  console.warn('[postinstall] 下载 Electron 运行时失败：' + e.message);
  console.warn('[postinstall] 可稍后手动补：node node_modules/electron/install.js');
  console.warn('[postinstall] 国内网络请先设镜像：');
  console.warn('[postinstall]   $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"');
  console.warn('');
}
