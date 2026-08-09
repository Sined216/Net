"""Площадка, в контексте которой идёт запрос.

Изоляция площадок держится на двух вещах. Первая — база: составные внешние
ключи (id, site_id) не дают кабелю соединить порты разных фабрик, что бы ни
делало приложение (см. миграцию 0012). Вторая — этот модуль: он отвечает на
вопрос «в какой площадке мы сейчас работаем» и «имеет ли человек на неё
право».

Площадка приходит заголовком `X-Site-Id`, а не параметром каждого маршрута:
её выбирают один раз в шапке интерфейса, и она относится ко всему запросу
целиком, как язык или часовой пояс. Когда площадка одна (обычный случай
завода, который только развернул систему), заголовок можно не слать — она
подставится сама.

Чужая площадка — 404, а не 403: ответ «нет доступа» подтвердил бы, что
такая площадка существует, а чужие данные не должны сообщать о себе даже
этого.
"""

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app import auth, models
from app.database import get_db

SITE_HEADER = "X-Site-Id"

NO_SITE = (
    "Не выбрана площадка: у вас их несколько, укажите нужную заголовком X-Site-Id"
)
NO_SITES_AT_ALL = (
    "Вам не назначена ни одна площадка — попросите администратора выдать доступ"
)


def accessible_sites(db: Session, user: models.User) -> list[models.Site]:
    """Площадки, с которыми человеку разрешено работать.

    Администратор видит все и в user_sites не нуждается: иначе заведение
    площадки требовало бы вторым шагом выдать права самому себе.
    """
    query = db.query(models.Site).order_by(models.Site.name)
    if user.role == "admin":
        return query.all()
    return (
        query.join(models.user_sites, models.user_sites.c.site_id == models.Site.id)
        .filter(models.user_sites.c.user_id == user.id)
        .all()
    )


def current_site_id(
    x_site_id: int | None = Header(None, alias=SITE_HEADER),
    user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
) -> int:
    """Площадка запроса — с проверкой права на неё."""
    allowed = accessible_sites(db, user)
    if not allowed:
        raise HTTPException(status_code=404, detail=NO_SITES_AT_ALL)

    if x_site_id is None:
        if len(allowed) == 1:
            return allowed[0].id
        raise HTTPException(status_code=400, detail=NO_SITE)

    if any(site.id == x_site_id for site in allowed):
        return x_site_id
    raise HTTPException(status_code=404, detail="Площадка не найдена")
