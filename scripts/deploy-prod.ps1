# HK Harp Centre POS v2 - Idempotent On-Premises Production Deployment
# Usage: npm.cmd run deploy:prod
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    # 1. Prevent stale user-level schooltracs env vars (port 3307) from overriding .env.
    $env:DATABASE_URL = $null
    $env:MIGRATE_DATABASE_URL = $null

    Write-Output "[1/6] Running pre-deploy MySQL backup..."
    $backupOut = & "$PSScriptRoot\backup-mysql.ps1"
    if ($LASTEXITCODE -ne 0) { throw "Pre-deploy MySQL backup failed (exit $LASTEXITCODE)" }
    $backupOut | ForEach-Object { Write-Output $_ }

    Write-Output "[2/6] Applying Drizzle MySQL migrations..."
    & npm.cmd run db:migrate
    if ($LASTEXITCODE -ne 0) { throw "db:migrate failed (exit $LASTEXITCODE)" }

    Write-Output "[3/6] Stopping HKHarpPOS task and releasing TCP port 3501..."
    cmd.exe /c 'schtasks /end /tn "HKHarpPOS" >nul 2>&1'
    Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'start-pos\.cmd' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    # Retire any legacy hkharpcentre-posv2 next start listener (e.g. old :3000) matching our repo
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'next start -p 3000' -and $_.CommandLine -match '--env-file=\.\./\.\./\.env' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Get-NetTCPConnection -LocalPort 3501 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }

    $released = $false
    for ($i = 0; $i -lt 20; $i++) {
        $listeners = Get-NetTCPConnection -LocalPort 3501 -State Listen -ErrorAction SilentlyContinue
        if (-not $listeners) {
            $released = $true
            break
        }
        Start-Sleep -Milliseconds 500
    }
    if (-not $released) {
        throw "TCP port 3501 is still occupied after stopping HKHarpPOS"
    }

    Write-Output "[4/6] Building Next.js production bundle & checking worker..."
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Production build failed (exit $LASTEXITCODE)" }

    Write-Output "[5/6] Starting HKHarpPOS scheduled task..."
    & schtasks.exe /run /tn "HKHarpPOS"
    if ($LASTEXITCODE -ne 0) { throw "Failed to start HKHarpPOS scheduled task (exit $LASTEXITCODE)" }

    Write-Output "[6/6] Waiting for http://127.0.0.1:3501/api/health..."
    $healthy = $false
    $healthBody = $null
    for ($i = 0; $i -lt 60; $i++) {
        try {
            $res = Invoke-RestMethod -Uri 'http://127.0.0.1:3501/api/health' -TimeoutSec 10
            if ($res.ok -eq $true -and $res.mysql.connected -eq $true -and $res.mysql.tableCount -eq 37) {
                $healthy = $true
                $healthBody = $res
                break
            }
        } catch {
            # Server still booting
        }
        Start-Sleep -Milliseconds 500
    }
    if (-not $healthy) {
        throw "Production server failed health check on http://127.0.0.1:3501/api/health within 30s"
    }

    $activePids = @(
        Get-NetTCPConnection -LocalPort 3501 -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
    )
    Write-Output "Deploy OK: port=3501 listening PID(s)=$($activePids -join ',') tableCount=$($healthBody.mysql.tableCount) products=$($healthBody.mysql.productCount) bills=$($healthBody.mysql.billCount)"
}
finally {
    Pop-Location
}
