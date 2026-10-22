@echo off
setlocal EnableExtensions

pushd "%~dp0"
if errorlevel 1 exit /b 1

set "NO_PAUSE=0"
set "INSTALL=1"
set "LAUNCH=0"
for %%A in (%*) do (
  if /i "%%~A"=="--no-pause" set "NO_PAUSE=1"
  if /i "%%~A"=="--no-install" set "INSTALL=0"
  if /i "%%~A"=="--launch" set "LAUNCH=1"
  if /i "%%~A"=="--help" goto :help
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 22.12+ first.
  goto :failed
)
where pnpm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] pnpm was not found. Run "corepack enable" or install pnpm first.
  goto :failed
)
where cargo >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Rust was not found. Install the MSVC toolchain from https://rustup.rs first.
  goto :failed
)

echo [1/5] Installing dependencies...
call pnpm install --frozen-lockfile
if errorlevel 1 goto :failed

echo [2/5] Closing running XMindmap instances...
powershell -NoProfile -Command "Get-Process xmindmap -ErrorAction SilentlyContinue | Stop-Process -Force" >nul 2>&1

echo [3/5] Building the desktop app and installer...
call pnpm app:build
if errorlevel 1 goto :failed

set "SETUP="
for /f "usebackq delims=" %%F in (`powershell -NoProfile -Command "Get-ChildItem -LiteralPath 'src-tauri\target\release\bundle\nsis' -Filter '*-setup.exe' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName"`) do set "SETUP=%%F"
if not defined SETUP (
  echo [ERROR] Installer not found under src-tauri\target\release\bundle\nsis.
  goto :failed
)

if "%INSTALL%"=="1" (
  echo [4/5] Installing %SETUP% ...
  powershell -NoProfile -Command "$p = Start-Process -FilePath '%SETUP%' -ArgumentList '/S' -Wait -PassThru; exit $p.ExitCode"
  if errorlevel 1 (
    echo [ERROR] The installer returned a failure code.
    goto :failed
  )
) else (
  echo [4/5] Skipping installation ^(--no-install^).
)

set "APP=%LOCALAPPDATA%\XMindmap\xmindmap.exe"
if not exist "%APP%" set "APP=%CD%\src-tauri\target\release\xmindmap.exe"

if "%LAUNCH%"=="1" (
  echo [5/5] Launching XMindmap...
  start "" "%APP%"
) else (
  echo [5/5] Done.
)

echo.
if "%INSTALL%"=="1" (
  echo [OK] XMindmap installed to %LOCALAPPDATA%\XMindmap
) else (
  echo [OK] Executable: %CD%\src-tauri\target\release\xmindmap.exe
)
echo      Installer:  %SETUP%
echo      Uninstall:  %LOCALAPPDATA%\XMindmap\uninstall.exe
set "BUILD_EXIT_CODE=0"
goto :finish

:help
set "NO_PAUSE=1"
echo Usage: build-app.cmd [options]
echo.
echo   --no-pause     Do not wait for a key press when finished.
echo   --no-install   Build only; skip running the NSIS installer.
echo   --launch       Start XMindmap after installing.
echo   --help         Show this help.
set "BUILD_EXIT_CODE=0"
goto :finish

:failed
echo.
echo [ERROR] Build failed. Check the output above.
set "BUILD_EXIT_CODE=1"

:finish
popd
if "%NO_PAUSE%"=="0" pause
exit /b %BUILD_EXIT_CODE%
