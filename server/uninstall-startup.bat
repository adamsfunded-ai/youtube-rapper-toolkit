@echo off
echo Removing YouTube Rapper Toolkit auto-start...
schtasks /delete /tn "YTRapperToolkitServer" /f
echo.
echo Stopping any running server...
taskkill /f /im node.exe /fi "WINDOWTITLE eq *server.js*" 2>nul
echo Done. Server will no longer auto-start.
pause
