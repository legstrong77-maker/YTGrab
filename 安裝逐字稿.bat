@echo off
chcp 65001 >nul
echo ============================================
echo   逐字稿工具 - 安裝相依套件
echo ============================================
echo.
echo [1/2] 安裝 CUDA 12.8 版 PyTorch (給 RTX 50 系列)...
pip install torch --index-url https://download.pytorch.org/whl/cu128
echo.
echo [2/2] 安裝其他套件...
pip install -r requirements-transcribe.txt
echo.
echo ============================================
echo   安裝完成！
echo   第一次啟動會自動下載 Breeze ASR 25 模型(約 5GB)，請耐心等待。
echo   啟動指令： python transcribe_server.py
echo   或直接執行： 啟動逐字稿.bat
echo ============================================
pause
