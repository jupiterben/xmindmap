@echo off
setlocal

pushd "%~dp0"
if errorlevel 1 exit /b 1

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 22.12+ first.
  goto :failed
)
where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm was not found. Install Node.js with npm first.
  goto :failed
)

echo [1/3] Installing editor dependencies...
call npm.cmd install --no-save
if errorlevel 1 goto :failed

echo [2/3] Installing VS Code extension dependencies...
call npm.cmd --prefix vscode-extension install --no-save
if errorlevel 1 goto :failed

echo [3/3] Compiling and packaging the VS Code extension...
call npm.cmd --prefix vscode-extension run package
if errorlevel 1 goto :failed

echo.
echo [OK] VSIX package generated in: %CD%\vscode-extension
set "BUILD_EXIT_CODE=0"
goto :finish

:failed
echo.
echo [ERROR] Build failed. Check the output above.
set "BUILD_EXIT_CODE=1"

:finish
popd
if /i not "%~1"=="--no-pause" pause
exit /b %BUILD_EXIT_CODE%
