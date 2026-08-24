FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY alembic.ini .
COPY alembic ./alembic
COPY app ./app

EXPOSE 8000

# Миграции накатываются до старта сервера: схему создаёт Alembic, а не
# приложение. Для базы, поднятой ещё старым create_all, db_upgrade сам
# проставит baseline — см. app/db_upgrade.py.
CMD ["sh", "-c", "python -m app.db_upgrade && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
