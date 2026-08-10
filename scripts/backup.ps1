# Резервная копия базы WireMap (Windows).
#
# Снимает дамп работающей базы прямо из контейнера и кладёт в backups\.
# Останавливать стек не нужно.
#
#   .\scripts\backup.ps1                    копия в backups\
#   .\scripts\backup.ps1 -Dir D:\backups    копия в другое место
#   .\scripts\backup.ps1 -Keep 30           сколько последних копий оставить
#
# В расписание — «Планировщик заданий», действие:
#   powershell -ExecutionPolicy Bypass -File C:\путь\Net\scripts\backup.ps1

[CmdletBinding()]
param(
    [string]$Dir,
    [int]$Keep = 14
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $Dir) { $Dir = Join-Path $repoRoot 'backups' }

function Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }

Set-Location $repoRoot

$running = docker compose ps --status running db 2>$null
if (-not ($running -match 'db')) {
    throw 'База не запущена. Поднимите стек: docker compose up -d'
}

New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$file = Join-Path $Dir "wiremap-$stamp.sql"

Step "Снимаю дамп в $file"
# Дамп пишется через перенаправление байт в байт: PowerShell иначе
# перекодирует поток в UTF-16 и портит файл.
$process = Start-Process -FilePath 'docker' `
    -ArgumentList 'compose', 'exec', '-T', 'db', 'pg_dump', '-U', 'netdoc', '--clean', '--if-exists', 'netdoc' `
    -NoNewWindow -Wait -PassThru -RedirectStandardOutput $file
if ($process.ExitCode -ne 0) { throw "pg_dump вернул код $($process.ExitCode)" }

# Пустой файл — это не копия, а иллюзия копии.
if ((Get-Item $file).Length -lt 1024) {
    Remove-Item $file -Force
    throw 'Дамп подозрительно мал — копия не сохранена'
}

Compress-Archive -Path $file -DestinationPath "$file.zip" -Force
Remove-Item $file -Force
Step "Готово: $([math]::Round((Get-Item "$file.zip").Length / 1MB, 2)) МБ"

if ($Keep -gt 0) {
    Get-ChildItem $Dir -Filter 'wiremap-*.sql.zip' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip $Keep |
        ForEach-Object {
            Step "Убираю старую копию: $($_.Name)"
            Remove-Item $_.FullName -Force
        }
}
