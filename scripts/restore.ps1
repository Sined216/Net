# Восстановление базы WireMap из резервной копии (Windows).
#
# Разворачивает дамп поверх существующей базы: всё, что накопилось после
# снятия копии, будет потеряно. Поэтому перед восстановлением скрипт сам
# снимает копию текущего состояния — на случай, если восстанавливали не то.
#
#   .\scripts\restore.ps1                              последняя копия из backups\
#   .\scripts\restore.ps1 -File backups\wiremap-...zip конкретная копия
#   .\scripts\restore.ps1 -Yes                         без вопроса

[CmdletBinding()]
param(
    [string]$File,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$backupDir = Join-Path $repoRoot 'backups'

function Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Warn($text) { Write-Host "!!  $text" -ForegroundColor Yellow }

Set-Location $repoRoot

if (-not $File) {
    $latest = Get-ChildItem $backupDir -Filter 'wiremap-*.sql.zip' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latest) { throw "В $backupDir нет ни одной копии" }
    $File = $latest.FullName
}
if (-not (Test-Path $File)) { throw "Файл не найден: $File" }

$running = docker compose ps --status running db 2>$null
if (-not ($running -match 'db')) {
    throw 'База не запущена. Поднимите стек: docker compose up -d db'
}

Warn "Текущее содержимое базы будет заменено копией от $(Split-Path -Leaf $File)"
if (-not $Yes) {
    $answer = Read-Host 'Продолжить? Введите «да»'
    if ($answer -ne 'да') { Write-Host 'Отменено'; exit 1 }
}

Step 'Снимаю копию текущего состояния — на случай ошибки'
& (Join-Path $PSScriptRoot 'backup.ps1') -Keep 0 | Out-Null

$temp = Join-Path $env:TEMP "wiremap-restore-$(Get-Random)"
New-Item -ItemType Directory -Force -Path $temp | Out-Null
Expand-Archive -Path $File -DestinationPath $temp -Force
$sql = Get-ChildItem $temp -Filter '*.sql' | Select-Object -First 1
if (-not $sql) { throw 'В архиве нет файла дампа' }

# Бэкенд на время восстановления останавливается: иначе он держит
# подключения и пишет в базу, которую в этот момент разбирают.
Step 'Останавливаю бэкенд'
docker compose stop backend | Out-Null

Step 'Разворачиваю копию'
Get-Content -Raw $sql.FullName | docker compose exec -T db psql -U netdoc -v ON_ERROR_STOP=1 -q netdoc
$code = $LASTEXITCODE

Step 'Поднимаю бэкенд'
docker compose start backend | Out-Null
Remove-Item $temp -Recurse -Force

if ($code -ne 0) { throw "psql вернул код $code — база могла остаться в неполном состоянии" }
Step 'Готово. Проверьте интерфейс — данные должны быть на момент снятия копии'
