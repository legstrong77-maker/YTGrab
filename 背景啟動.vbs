' YTGrab 影音工作台 — 背景隱藏啟動（不顯示視窗）
' 重要：輸出一律導向 log 檔，避免背景主控台卡住程式寫入（Windows console 已知問題）。
Set sh = CreateObject("WScript.Shell")
proj = "C:\Users\User\Desktop\youtube dl"
sh.CurrentDirectory = proj
' 參數 0 = 隱藏；False = 不等待。> log 2>&1 把輸出寫到檔案而非主控台。
sh.Run "cmd /c python transcribe_server.py > transcribe_server.log 2>&1", 0, False
sh.Run "cmd /c node server.js > server.log 2>&1", 0, False
