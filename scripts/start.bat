@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo   正在启动 英语单词闯关营...
echo ========================================

set "NODE_BIN=%~dp0node\win-x64\node.exe"
if exist "%NODE_BIN%" (
  echo 使用包内 Node
  "%NODE_BIN%" "%~dp0server\server.js"
  goto :end
)

where node >nul 2>nul
if %errorlevel%==0 (
  echo 使用系统 Node
  node "%~dp0server\server.js"
  goto :end
)

echo 未找到 Node 运行时，请安装 Node.js 或下载完整版包。
echo 安装地址: https://nodejs.org
goto :end

:end
echo.
pause
