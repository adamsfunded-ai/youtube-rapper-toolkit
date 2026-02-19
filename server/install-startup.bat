@echo off
echo ============================================
echo  YouTube Rapper Toolkit - Install Startup
echo ============================================
echo.

:: Get the directory this script lives in
set SCRIPT_DIR=%~dp0

:: Create a scheduled task that runs at logon, hidden
schtasks /create /tn "YTRapperToolkitServer" /tr "wscript.exe \"%SCRIPT_DIR%start-hidden.vbs\"" /sc onlogon /rl limited /f

if %errorlevel% equ 0 (
    echo.
    echo SUCCESS! The server will now auto-start when you log in.
    echo It runs completely headless - no window, no tray icon.
    echo Uses ~0 CPU and ~30MB RAM when idle.
    echo.
    echo Starting the server now...
    wscript.exe "%SCRIPT_DIR%start-hidden.vbs"
    echo Server is running on http://127.0.0.1:3456
) else (
    echo.
    echo FAILED to create scheduled task. Try running as administrator.
)

echo.
pause
