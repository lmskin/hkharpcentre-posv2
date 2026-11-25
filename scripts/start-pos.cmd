@ECHO OFF
REM ============================================================
REM  HK Harp Centre POS v2 - production server
REM  Started hidden by Scheduled Task "HKHarpPOS" at user logon.
REM  Auto-restarts in background if the server exits unexpectedly.
REM ============================================================
if not "%POS_HIDDEN_BG%"=="1" (
    echo Starting HK Harp Centre POS v2 in background ^(http://127.0.0.1:3501^)...
    "C:\Windows\System32\wscript.exe" //B //NoLogo "%~dp0start-pos-hidden.vbs"
    exit /b 0
)

cd /d C:\hkharpcentre-posv2\apps\web
if not exist C:\hkharpcentre-posv2\logs mkdir C:\hkharpcentre-posv2\logs

REM This machine has a stale USER-level DATABASE_URL (schooltracs project,
REM port 3307). Existing env vars override node --env-file, so clear it or
REM the server silently connects to the wrong MySQL.
set "DATABASE_URL="
set "MIGRATE_DATABASE_URL="

REM Clean up any older background cmd wrapper or orphaned listener on TCP 3501.
powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "$me=(Get-CimInstance Win32_Process -Filter ('ProcessId='+$PID)).ParentProcessId; Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" | Where-Object { $_.ProcessId -ne $me -and $_.CommandLine -match 'start-pos\.cmd' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":3501[ ][ ]*.*LISTENING"') do if NOT "%%p"=="0" taskkill /F /PID %%p >nul 2>&1

:loop
echo %DATE% %TIME% starting next start >> C:\hkharpcentre-posv2\logs\pos-server.log
"C:\Program Files\nodejs\node.exe" --env-file=../../.env ../../node_modules/next/dist/bin/next start -p 3501 >> C:\hkharpcentre-posv2\logs\pos-server.log 2>&1
echo %DATE% %TIME% server exited, restarting in 5s >> C:\hkharpcentre-posv2\logs\pos-server.log
timeout /t 5 /nobreak >nul
goto loop
