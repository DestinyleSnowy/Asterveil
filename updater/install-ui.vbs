Option Explicit
Dim shell, fso, base, binary, directory, quote
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
binary = fso.BuildPath(base, "updater\windows-x64\asterveil-updater.exe")
directory = fso.BuildPath(base, "extension")
quote = Chr(34)
shell.Run quote & binary & quote & " --setup " & quote & directory & quote, 0, False
