#!/usr/bin/env bash
# Резервная копия базы WireMap.
#
# Снимает дамп работающей базы прямо из контейнера и кладёт в backups/.
# Останавливать стек не нужно: pg_dump снимает согласованный снимок, а
# работающие люди этого не замечают.
#
#   ./scripts/backup.sh                 копия в backups/
#   ./scripts/backup.sh --dir /mnt/nas  копия в другое место
#   ./scripts/backup.sh --keep 30       сколько последних копий оставить (по умолчанию 14)
#
# В расписание (каждую ночь в 3:15):
#   15 3 * * *  /путь/до/Net/scripts/backup.sh >> /var/log/wiremap-backup.log 2>&1

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$REPO_ROOT/backups"
KEEP=14

while [ $# -gt 0 ]; do
    case "$1" in
        --dir) BACKUP_DIR="$2"; shift 2 ;;
        --keep) KEEP="$2"; shift 2 ;;
        -h|--help) sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Неизвестный аргумент: $1" >&2; exit 2 ;;
    esac
done

step() { printf '\033[36m==> %s\033[0m\n' "$1"; }

cd "$REPO_ROOT"

if ! docker compose ps --status running db 2>/dev/null | grep -q db; then
    echo 'База не запущена. Поднимите стек: docker compose up -d' >&2
    exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/wiremap-$STAMP.sql.gz"

step "Снимаю дамп в $FILE"
# -T: без псевдотерминала, иначе в поток попадают управляющие символы и
# дамп получается битым.
docker compose exec -T db pg_dump -U netdoc --clean --if-exists netdoc | gzip -9 > "$FILE"

# Пустой или обрезанный файл — это не копия, а иллюзия копии. Проверяем
# сразу: узнать о том, что копий не было, во время восстановления поздно.
SIZE=$(wc -c < "$FILE")
if [ "$SIZE" -lt 1024 ]; then
    echo "Дамп подозрительно мал ($SIZE байт) — копия не сохранена" >&2
    rm -f "$FILE"
    exit 1
fi
gzip -t "$FILE"

step "Готово: $(du -h "$FILE" | cut -f1)"

if [ "$KEEP" -gt 0 ]; then
    # shellcheck disable=SC2012
    ls -1t "$BACKUP_DIR"/wiremap-*.sql.gz 2>/dev/null | tail -n "+$((KEEP + 1))" | while read -r old; do
        step "Убираю старую копию: $(basename "$old")"
        rm -f "$old"
    done
fi
