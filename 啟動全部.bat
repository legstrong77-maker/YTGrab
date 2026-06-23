@echo off
chcp 65001 >nul
cd /d "%~dp0"
title YTGrab 一鍵啟動

echo ============================================
echo   YTGrab 影音工作台 - 一鍵啟動
echo ============================================
echo.
echo 啟動兩個服務（輸出寫入 transcribe_server.log / server.log）...
echo 重要：輸出導向 log 檔，避免背景主控台卡住程式（Windows console 已知問題）。
echo.

REM /min 最小化視窗；cmd /c "... > log 2>&1" 把輸出導到檔案，主控台永遠不會阻塞程式
start "逐字稿後端 (8001)" /min cmd /c "python transcribe_server.py > transcribe_server.log 2>&1"
start "YTGrab 主站 (3000)" /min cmd /c "node server.js > server.log 2>&1"

echo 逐字稿後端第一次載入模型需數十秒，請稍候...
timeout /t 8 >nul
start "" http://localhost:3000

echo.
echo 已開啟 http://localhost:3000
echo 想看狀態可開啟 transcribe_server.log / server.log
echo 要停止服務請雙擊「停止全部.bat」。此視窗可關閉。
timeout /t 5 >nul
