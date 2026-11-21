@ECHO OFF
REM ============================================================
REM  HK Harp Centre POS v2 - production server
REM  Started by Scheduled Task "HKHarpPOS" at user logon.
REM  Auto-restarts if the server process exits unexpectedly.
REM ============================================================
cd /d C:\hkharpcentre-posv2\apps\web
if not exist C:\hkharpcentre-posv2\logs mkdir C:\hkharpcentre-posv2\logs

REM This machine has a stale USER-level DATABASE_URL (schooltracs project,
REM port 3307). Existing env vars override node --env-file, so clear it or
REM the server silently connects to the wrong MySQL.
set "DATABASE_URL="
set "MIGRATE_DATABASE_URL="

:loop
echo %DATE% %TIME% starting next start >> C:\hkharpcentre-posv2\logs\pos-server.log
"C:\Program Files\nodejs\node.exe" --env-file=../../.env ../../node_modules/next/dist/bin/next start -p 3000 >> C:\hkharpcentre-posv2\logs\pos-server.log 2>&1
echo %DATE% %TIME% server exited, restarting in 5s >> C:\hkharpcentre-posv2\logs\pos-server.log
timeout /t 5 /nobreak >nul
goto loop
