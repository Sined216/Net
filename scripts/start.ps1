<#
.SYNOPSIS
    Разворачивает NetDoc на этой машине одной командой.

.DESCRIPTION
    При первом запуске создаёт .env со случайными паролями и ключом подписи
    токенов, затем собирает и поднимает весь стек в Docker. Повторный запуск
    существующий .env не трогает — пароли не меняются.

.PARAMETER EnvOnly
    Только создать .env и выйти, ничего не собирая.

.PARAMETER Recreate
    Пересобрать образы с нуля, без использования кеша.

.EXAMPLE
    .\scripts\start.ps1
#>
[CmdletBinding()]
param(
    [switch]$EnvOnly,
    [switch]$Recreate
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $RepoRoot '.env'

function Write-Step($Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Warn($Message) { Write-Host "!!  $Message" -ForegroundColor Yellow }

function New-Secret([int]$ByteCount = 36) {
    # URL-safe base64: значение попадает в .env и в переменные окружения,
    # где символы / + = только мешают.
    $bytes = New-Object byte[] $ByteCount
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Test-Docker {
    Write-Step 'Проверяю Docker'
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker не найден. Установите Docker Desktop: https://www.docker.com/products/docker-desktop/"
    }
    docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker установлен, но не запущен. Откройте Docker Desktop и дождитесь статуса Running.'
    }
}

function New-EnvFile {
    if (Test-Path $EnvFile) {
        Write-Step '.env уже есть — оставляю как есть'
        return $false
    }

    Write-Step 'Создаю .env со случайными паролями'
    $adminPassword = New-Secret 12
    @(
        '# Создан scripts/start.ps1. Файл содержит пароли — в git не попадает.',
        '',
        '# production включает проверку настроек при старте: приложение не',
        '# поднимется с дефолтным или коротким ключом подписи токенов.',
        'ENVIRONMENT=production',
        '',
        '# Ключ подписи JWT. Если поменять — все выданные токены станут',
        '# недействительны и все пользователи будут разлогинены.',
        "SECRET_KEY=$(New-Secret 48)",
        '',
        '# Пароль пользователя PostgreSQL. Меняется только вместе с пересозданием',
        '# тома базы (docker compose down -v), иначе бэкенд не подключится.',
        "POSTGRES_PASSWORD=$(New-Secret 24)",
        '',
        '# Администратор, создаваемый при первом запуске (пока база пуста).',
        'BOOTSTRAP_ADMIN_USERNAME=admin',
        "BOOTSTRAP_ADMIN_PASSWORD=$adminPassword",
        '',
        '# Порты на этой машине.',
        'WEB_PORT=8080',
        'API_PORT=8000'
    ) | Set-Content -Path $EnvFile -Encoding UTF8

    Write-Host ''
    Write-Host '    Логин:  admin' -ForegroundColor Green
    Write-Host "    Пароль: $adminPassword" -ForegroundColor Green
    Write-Host '    (сохранён в .env, там же можно посмотреть позже)'
    Write-Host ''
    return $true
}

function Get-EnvValue([string]$Name, [string]$Default) {
    if (-not (Test-Path $EnvFile)) { return $Default }
    $line = Select-String -Path $EnvFile -Pattern "^$Name=(.*)$" | Select-Object -First 1
    if ($line) { return $line.Matches[0].Groups[1].Value } else { return $Default }
}

function Start-Stack {
    Write-Step 'Собираю образы и поднимаю стек (первый раз это несколько минут)'
    Push-Location $RepoRoot
    try {
        if ($Recreate) {
            docker compose build --no-cache
            if ($LASTEXITCODE -ne 0) { throw 'Сборка образов не удалась' }
        }
        docker compose up -d --build
        if ($LASTEXITCODE -ne 0) { throw 'Не удалось поднять стек. Подробности: docker compose logs' }
    }
    finally { Pop-Location }
}

function Wait-Ready([int]$TimeoutSeconds = 180) {
    $webPort = Get-EnvValue 'WEB_PORT' '8080'
    $url = "http://localhost:$webPort/api/health"
    Write-Step "Жду готовности $url"

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200) { return $webPort }
        }
        catch { Start-Sleep -Seconds 3 }
    }
    throw "Стек не ответил за $TimeoutSeconds секунд. Посмотрите логи: docker compose logs"
}

Test-Docker
$created = New-EnvFile

if ($EnvOnly) {
    Write-Step 'Ключ -EnvOnly: останавливаюсь, стек не поднимаю'
    exit 0
}

Start-Stack
$webPort = Wait-Ready

Write-Host ''
Write-Host "NetDoc работает: http://localhost:$webPort" -ForegroundColor Green
Write-Host "Swagger UI:      http://localhost:$(Get-EnvValue 'API_PORT' '8000')/docs"
Write-Host ''
if ($created) {
    Write-Warn 'Пароль администратора сгенерирован и лежит в .env — смените его после первого входа.'
}
Write-Host 'Остановить:  docker compose down'
Write-Host 'Логи:        docker compose logs -f'
