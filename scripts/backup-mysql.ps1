# HK Harp Centre POS v2 - daily MySQL backup
# Mirrors the legacy MSSQL_Backup_erun.bat pattern:
#   dump -> C:\eRun\Support\mysql\ -> 7z compress -> delete raw .sql -> 14-day retention
# Scheduled Task "HKHarpPOS-MySQL-Backup" runs this daily at 13:37.
$ErrorActionPreference = 'Stop'

$repo        = 'C:\hkharpcentre-posv2'
$backupDir   = 'C:\eRun\Support\mysql'
$mysqldump   = 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe'
$sevenZip    = 'C:\Program Files\7-Zip\7z.exe'
$retentionDays = 14

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

# --- read credentials from .env (DATABASE_URL=mysql://user:pass@host:port/db) ---
$line = Get-Content "$repo\.env" | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $line) { throw 'DATABASE_URL not found in .env' }
$uri  = [Uri]($line.Substring('DATABASE_URL='.Length).Trim().Trim('"'))
$user = $uri.UserInfo.Split(':')[0]
$pass = [Uri]::UnescapeDataString($uri.UserInfo.Split(':', 2)[1])
$db   = $uri.AbsolutePath.TrimStart('/')

$stamp   = Get-Date -Format 'yyyyMMdd_HHmmss'
$sqlFile = Join-Path $backupDir "hkharp_pos_$stamp.sql"
$arcFile = "$sqlFile.7z"

$env:MYSQL_PWD = $pass
try {
    & $mysqldump --single-transaction --routines --triggers --no-tablespaces `
        --compression-algorithms=zlib,zstd,uncompressed --set-gtid-purged=OFF `
        --default-character-set=utf8mb4 `
        -h $uri.Host -P $uri.Port -u $user $db --result-file="$sqlFile"
    if ($LASTEXITCODE -ne 0) { throw "mysqldump exited with code $LASTEXITCODE" }
}
finally {
    Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
}

& $sevenZip a -mx=5 "$arcFile" "$sqlFile" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "7z exited with code $LASTEXITCODE" }
Remove-Item $sqlFile -Force

# --- retention: keep last N days ---
Get-ChildItem $backupDir -Filter 'hkharp_pos_*.7z' |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$retentionDays) } |
    Remove-Item -Force

$size = (Get-Item $arcFile).Length
Add-Content "$backupDir\backup.log" "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') OK $arcFile ($size bytes)"
Write-Output "Backup OK: $arcFile ($size bytes)"
