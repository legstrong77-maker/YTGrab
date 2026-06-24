' YTGrab background launcher - starts both servers hidden, output redirected to log files.
' Content kept ASCII-only so Windows Script Host (ANSI) parses it correctly.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\User\Desktop\youtube dl"
' Make sure yt-dlp can find the deno JS runtime (needed by newer yt-dlp for YouTube).
Set env = sh.Environment("PROCESS")
env("PATH") = "C:\Users\User\AppData\Local\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe;" & env("PATH")
sh.Run "cmd /c python transcribe_server.py > transcribe_server.log 2>&1", 0, False
sh.Run "cmd /c node server.js > server.log 2>&1", 0, False
