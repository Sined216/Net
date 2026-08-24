#!/usr/bin/env bash
# Восстановление базы WireMap из резервной копии.
#
# Разворачивает дамп поверх существующей базы: всё, что накопилось после
# снятия копии, будет потеряно. Поэтому перед восстановлением скрипт сам
# снимает копию текущего состояния — на случай, если восстанавливали не то.
#
#   ./scripts/restore.sh                        последняя копия из backups/
#   ./scripts/restore.sh backups/wiremap-....gz  конкретная копия
#   ./scripts/restore.sh --yes ...              без вопроса (для скриптов)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$REPO_ROOT/backups"
ASSUME_YES=0
FILE=""

while [ $# -gt 0 ]; do
    case "$1" in
        --yes|-y) ASSUME_YES=1; shift ;;
        -h|--help) sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) FILE="$1"; shift ;;
    esac
done

step() { printf '\033[36m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[33m!!  %s\033[0m\n' "$1"; }

cd "$REPO_ROOT"

if [ -z "$FILE" ]; then
    # shellcheck disable=SC2012
    FILE="$(ls -1t "$BACKUP_DIR"/wiremap-*.sql.gz 2>/dev/null | head -1 || true)"
    [ -n "$FILE" ] || { echo "В $BACKUP_DIR нет ни одной копии" >&2; exit 1; }
fi
[ -f "$FILE" ] || { echo "Файл не найден: $FILE" >&2; exit 1; }

if ! docker compose ps --status running db 2>/dev/null | grep -q db; then
    echo 'База не запущена. Поднимите стек: docker compose up -d db' >&2
    exit 1
fi

warn "Текущее содержимое базы будет заменено копией от $(basename "$FILE")"
if [ "$ASSUME_YES" -eq 0 ]; then
    read -r -p 'Продолжить? Введите «да»: ' answer
    [ "$answer" = "да" ] || { echo 'Отменено'; exit 1; }
fi

step 'Снимаю копию текущего состояния — на случай ошибки'
"$REPO_ROOT/scripts/backup.sh" --keep 0 >/dev/null

# Бэкенд на время восстановления останавливается: иначе он держит
# подключения и пишет в базу, которую в этот момент разбирают.
step 'Останавливаю бэкенд'
docker compose stop backend >/dev/null

step 'Разворачиваю копию'
# Вывод psql глушим: ошибки он пишет в stderr и с ON_ERROR_STOP
# останавливается на первой же, а перечень выполненных команд не нужен.
gunzip -c "$FILE" | docker compose exec -T db psql -U netdoc -v ON_ERROR_STOP=1 -q netdoc >/dev/null

step 'Поднимаю бэкенд'
docker compose start backend >/dev/null

step 'Готово. Проверьте интерфейс — данные должны быть на момент снятия копии'
