#!/usr/bin/env bash
# Разворачивает NetDoc на этой машине одной командой.
#
# При первом запуске создаёт .env со случайными паролями и ключом подписи
# токенов, затем собирает и поднимает весь стек в Docker. Повторный запуск
# существующий .env не трогает — пароли не меняются.
#
#   ./scripts/start.sh              обычный запуск
#   ./scripts/start.sh --env-only   только создать .env
#   ./scripts/start.sh --recreate   пересобрать образы без кеша

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

ENV_ONLY=0
RECREATE=0
for arg in "$@"; do
    case "$arg" in
        --env-only) ENV_ONLY=1 ;;
        --recreate) RECREATE=1 ;;
        -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Неизвестный аргумент: $arg" >&2; exit 2 ;;
    esac
done

step() { printf '\033[36m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[33m!!  %s\033[0m\n' "$1"; }

new_secret() {
    # URL-safe base64: значение попадает в .env и переменные окружения,
    # где символы / + = только мешают.
    head -c "${1:-36}" /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n'
}

check_docker() {
    step 'Проверяю Docker'
    command -v docker >/dev/null 2>&1 || {
        echo 'Docker не найден. Установите: https://docs.docker.com/engine/install/' >&2
        exit 1
    }
    docker info >/dev/null 2>&1 || {
        echo 'Docker установлен, но демон не запущен (или нет прав). Запустите Docker и повторите.' >&2
        exit 1
    }
}

created_env=0
create_env() {
    if [ -f "$ENV_FILE" ]; then
        step '.env уже есть — оставляю как есть'
        return
    fi

    step 'Создаю .env со случайными паролями'
    local admin_password
    admin_password="$(new_secret 12)"

    cat > "$ENV_FILE" <<EOF
# Создан scripts/start.sh. Файл содержит пароли — в git не попадает.

# production включает проверку настроек при старте: приложение не поднимется
# с дефолтным или коротким ключом подписи токенов.
ENVIRONMENT=production

# Ключ подписи JWT. Если поменять — все выданные токены станут
# недействительны и все пользователи будут разлогинены.
SECRET_KEY=$(new_secret 48)

# Пароль пользователя PostgreSQL. Меняется только вместе с пересозданием
# тома базы (docker compose down -v), иначе бэкенд не подключится.
POSTGRES_PASSWORD=$(new_secret 24)

# Администратор, создаваемый при первом запуске (пока база пуста).
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=$admin_password

# Порты на этой машине.
WEB_PORT=8080
API_PORT=8000
EOF
    chmod 600 "$ENV_FILE"

    printf '\n    \033[32mЛогин:  admin\033[0m\n'
    printf '    \033[32mПароль: %s\033[0m\n' "$admin_password"
    printf '    (сохранён в .env, там же можно посмотреть позже)\n\n'
    created_env=1
}

env_value() {
    local name="$1" default="$2"
    [ -f "$ENV_FILE" ] || { echo "$default"; return; }
    local value
    value="$(grep -E "^${name}=" "$ENV_FILE" | head -1 | cut -d= -f2-)"
    echo "${value:-$default}"
}

start_stack() {
    step 'Собираю образы и поднимаю стек (первый раз это несколько минут)'
    cd "$REPO_ROOT"
    [ "$RECREATE" -eq 1 ] && docker compose build --no-cache
    docker compose up -d --build
}

wait_ready() {
    local web_port timeout=180 waited=0
    web_port="$(env_value WEB_PORT 8080)"
    step "Жду готовности http://localhost:${web_port}/api/health"

    while [ "$waited" -lt "$timeout" ]; do
        if curl -fsS "http://localhost:${web_port}/api/health" >/dev/null 2>&1; then
            return 0
        fi
        sleep 3
        waited=$((waited + 3))
    done
    echo "Стек не ответил за ${timeout} секунд. Посмотрите логи: docker compose logs" >&2
    exit 1
}

check_docker
create_env

if [ "$ENV_ONLY" -eq 1 ]; then
    step 'Ключ --env-only: останавливаюсь, стек не поднимаю'
    exit 0
fi

start_stack
wait_ready

printf '\n\033[32mNetDoc работает: http://localhost:%s\033[0m\n' "$(env_value WEB_PORT 8080)"
printf 'Swagger UI:      http://localhost:%s/docs\n\n' "$(env_value API_PORT 8000)"
[ "$created_env" -eq 1 ] && warn 'Пароль администратора сгенерирован и лежит в .env — смените его после первого входа.'
printf 'Остановить:  docker compose down\n'
printf 'Логи:        docker compose logs -f\n'
