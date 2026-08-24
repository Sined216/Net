"""Выгрузить описание API в `backend/openapi.json`.

Из него генерируются типы фронтенда (`frontend/npm run codegen`). Раньше
типы переписывались руками, и каждое новое поле приходилось дублировать в
двух местах; расхождение при этом ничем не ловилось — только глазами.

Сервер для выгрузки поднимать не нужно: описание собирается из самого
приложения. Файл лежит в репозитории, чтобы фронтенд собирался без базы и
без запущенного бэкенда, а CI проверял, что он не отстал от кода.

    python -m scripts.dump_openapi          записать файл
    python -m scripts.dump_openapi --check  сверить, не устарел ли
"""

import json
import os
import sys
from pathlib import Path

# Описание API строится без подключения к базе, но конфигурация проверяется
# на старте — подставляем безопасные значения для режима разработки.
os.environ.setdefault("SECRET_KEY", "dump-openapi-only")
os.environ.setdefault("ENVIRONMENT", "development")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app  # noqa: E402

TARGET = Path(__file__).resolve().parents[1] / "openapi.json"


def render() -> str:
    # Отсортированные ключи и отступ: файл лежит в git, и осмысленная
    # разница важнее компактности.
    return json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main() -> int:
    fresh = render()
    if "--check" in sys.argv:
        current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""
        if current != fresh:
            print(
                "openapi.json устарел. Выполните:\n"
                "  cd backend && python -m scripts.dump_openapi\n"
                "  cd frontend && npm run codegen",
                file=sys.stderr,
            )
            return 1
        print("openapi.json совпадает с кодом")
        return 0

    TARGET.write_text(fresh, encoding="utf-8")
    print(f"записано: {TARGET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
