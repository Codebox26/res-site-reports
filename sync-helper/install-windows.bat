@echo off
setlocal
echo.
echo ============================================================
echo   RES Sync Helper - Windows Installer
echo ============================================================
echo.

:: Check Python is installed
where python >nul 2>nul
if errorlevel 1 (
    echo ERROR: Python not found on this computer.
    echo.
    echo Please install Python 3 from:
    echo   https://www.python.org/downloads/
    echo.
    echo IMPORTANT: During install, tick "Add Python to PATH"
    echo.
    pause
    exit /b 1
)

echo Python found:
python --version
echo.

:: Check config file exists
if not exist "%~dp0config.json" (
    echo ERROR: config.json not found.
    echo.
    echo Please copy config.example.json to config.json and edit it:
    echo   1. api_base_url   - your Render app URL
    echo   2. sync_api_key   - from your Render env vars
    echo   3. onedrive_base_path - your OneDrive reports folder
    echo   4. laptop_id      - a unique name for this laptop
    echo.
    pause
    exit /b 1
)

:: Install the requests library
echo Installing Python dependencies...
python -m pip install --user requests
if errorlevel 1 (
    echo WARNING: pip install had issues. Trying to continue...
)
echo.

:: Set up Windows Task Scheduler to run at login
set SCRIPT_PATH=%~dp0res_sync.py
echo Setting up auto-start at login (Task Scheduler)...

schtasks /delete /tn "RES Sync Helper" /f >nul 2>nul

schtasks /create ^
  /tn "RES Sync Helper" ^
  /tr "python \"%SCRIPT_PATH%\"" ^
  /sc ONLOGON ^
  /rl HIGHEST ^
  /f

if errorlevel 1 (
    echo WARNING: Could not create scheduled task. You may need to run this as Administrator.
    echo The sync helper will not start automatically at login.
    echo You can still run it manually: python "%SCRIPT_PATH%"
) else (
    echo Auto-start registered successfully.
)
echo.

:: Start the script now in the background (minimised)
echo Starting RES Sync Helper now...
start /min "RES Sync Helper" python "%SCRIPT_PATH%"

echo.
echo ============================================================
echo   Installation complete!
echo.
echo   The sync helper is now running in the background.
echo   New site reports will appear in your OneDrive folder
echo   within 60 seconds of each submission.
echo.
echo   Log file: %~dp0sync.log
echo ============================================================
echo.
pause
endlocal
