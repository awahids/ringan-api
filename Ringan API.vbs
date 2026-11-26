' Menjalankan Ringan API tanpa jendela console. Server berhenti otomatis ~3 menit setelah jendela aplikasi ditutup.
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Run "node """ & dir & "\server.js"" --auto-exit", 0, False
