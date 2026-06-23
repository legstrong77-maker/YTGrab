@echo off
chcp 65001 >nul
title 停止 YTGrab 服務
echo 正在停止 YTGrab 主站與逐字稿後端...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'server\.js' -or $_.CommandLine -match 'transcribe_server\.py' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo.
echo 已停止。若要重新啟動，雙擊「啟動全部.bat」或重開機（已設定開機自動啟動）。
timeout /t 4 >nul
