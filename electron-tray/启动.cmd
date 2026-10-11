@echo off
rem ============================================================
rem  Launch the Weekly Digest tray pet.
rem
rem  WHY THIS SCRIPT EXISTS:
rem  Some environments (including DSH's own session) set
rem      ELECTRON_RUN_AS_NODE=1
rem  That makes Electron behave as plain Node: require('electron')
rem  returns only a path string, so ipcMain / Tray / app are all
rem  undefined and the app crashes on startup. We clear it here.
rem
rem  NOTE: this file is intentionally ASCII-only. Batch files are
rem  read using the OEM code page, so UTF-8 Chinese text here would
rem  be mangled into invalid commands. See README.md for details.
rem ============================================================
setlocal
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"

set EXE=node_modules\electron\dist\electron.exe

if not exist "%EXE%" (
  echo.
  echo [ERROR] Electron is not installed in this folder.
  echo         Run this first:
  echo             pnpm install
  echo         If the download hangs, see the mirror notes in README.md
  echo.
  pause
  exit /b 1
)

start "" "%EXE%" .
endlocal
