@echo off
chcp 65001 >nul
echo 啟動逐字稿工具中… 載入模型需數十秒，請稍候。
echo 載入完成後會顯示網址，請用瀏覽器開啟 http://localhost:8001
echo.
python transcribe_server.py
pause
