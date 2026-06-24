' YTGrab background launcher - starts both servers hidden, output redirected to log files.
' Content kept ASCII-only so Windows Script Host (ANSI) parses it correctly.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\User\Desktop\youtube dl"
sh.Run "cmd /c python transcribe_server.py > transcribe_server.log 2>&1", 0, False
sh.Run "cmd /c node server.js > server.log 2>&1", 0, False
