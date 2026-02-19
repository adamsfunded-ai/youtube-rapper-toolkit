' YouTube Rapper Toolkit - Headless Server Launcher
' This script starts the Node.js server with NO visible window.
' It uses virtually zero resources when idle (Node just listens on a port).

Dim serverDir
serverDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)

Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = serverDir

' Launch node server.js completely hidden (0 = hidden, false = don't wait)
shell.Run "node """ & serverDir & "\server.js""", 0, False
