@echo off
title jmf admin panel v2.0.0
echo.
echo  ╔══════════════════════════════════════╗
echo  ║  jmf admin panel v2.0.0             ║
echo  ║  جاري التشغيل...                    ║
echo  ╚══════════════════════════════════════╝
echo.

cd /d "%~dp0"

set "NODE_CMD=node"
where node >nul 2>&1
if %errorlevel% neq 0 (
    if exist "..\node-runtime\node.exe" (
        set "NODE_CMD=..\node-runtime\node.exe"
        echo  ✓ تم العثور على Node.js المدمج
    ) else (
        echo  ✗ Node.js غير مُثبّت — حمّله من https://nodejs.org
        pause
        exit /b 1
    )
) else (
    echo  ✓ Node.js موجود في النظام
)

echo  ✓ جاري تشغيل السيرفر...
echo  ✓ افتح المتصفح على: http://localhost:3456
echo.

start http://localhost:3456
"%NODE_CMD%" server.js
pause
