from sqlalchemy import (
    Column, Index, Integer, BigInteger, Text, Boolean, Float, ForeignKey, ForeignKeyConstraint,
    CheckConstraint, UniqueConstraint, Numeric, Date, DateTime, JSON, Table,
    func,
)
from sqlalchemy.dialects.postgresql import CIDR, INET, MACADDR
from sqlalchemy.orm import relationship, backref
from app.database import Base

# Адреса и даты хранятся нативными типами PostgreSQL, а не строками: база
# сама отвергает мусор вроде "10.10.1.300", нормализует запись MAC и умеет
# искать по подсети. Раньше модели объявляли эти колонки как String, хотя
# schema.sql описывал INET/CIDR/MACADDR/DATE — и база, поднятая приложением,
# отличалась от базы, поднятой из schema.sql.


class Site(Base):
    """Площадка — отдельная фабрика.

    Сети разных фабрик не пересекаются никак: устройство, кабель, тег и VLAN
    принадлежат ровно одной площадке, и связь между площадками невозможна не
    по договорённости, а по устройству базы (составные внешние ключи ниже).

    Общими остаются справочники моделей техники и пресетов кабелей: заводить
    «Cisco Catalyst 2960» заново на каждой фабрике незачем. Люди тоже общие —
    один человек может обслуживать несколько площадок (таблица user_sites).
    """
    __tablename__ = "sites"
    id = Column(Integer, primary_key=True)
    name = Column(Text, unique=True, nullable=False)
    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# Кому какие площадки доступны. Роль admin видит все и в этой таблице не
# нуждается — иначе заведение площадки требовало бы ещё и раздачи прав себе.
user_sites = Table(
    "user_sites", Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("site_id", Integer, ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True),
)


class Tag(Base):
    """Тег для группировки устройств — вложенный (parent_id), устройство
    может иметь сразу несколько тегов. Пришёл на замену площадкам: место
    (или любая другая группировка — по критичности, по линии и т.п.)
    теперь просто тег, а не отдельная жёстко заданная сущность.

    Сами теги принадлежат площадке: «Цех 1» есть на каждой фабрике, и это
    разные цеха."""
    __tablename__ = "tags"
    id = Column(Integer, primary_key=True)
    site_id = Column(Integer, ForeignKey("sites.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(Text, nullable=False)
    parent_id = Column(Integer, ForeignKey("tags.id", ondelete="CASCADE"))
    color = Column(Text)

    __table_args__ = (UniqueConstraint("site_id", "parent_id", "name"),)

    # passive_deletes=True: не заставлять SQLAlchemy предварительно обнулять
    # parent_id у дочерних тегов при удалении родителя — доверяем это
    # ON DELETE CASCADE в самой базе (без этого SQLAlchemy по умолчанию
    # сама выполняет UPDATE ... SET parent_id = NULL вместо каскадного
    # удаления, и дочерние теги остаются висеть без родителя).
    parent = relationship("Tag", remote_side=[id], backref=backref("children", passive_deletes=True))


# Устройство <-> тег: чистая связка многие-ко-многим, без своих полей.
device_tags = Table(
    "device_tags", Base.metadata,
    Column("device_id", Integer, ForeignKey("devices.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    full_name = Column(Text, nullable=False)
    username = Column(Text, unique=True, nullable=False)
    password_hash = Column(Text, nullable=False)
    role = Column(Text, nullable=False)
    # Мягкая блокировка вместо удаления: audit_log ссылается на пользователя,
    # и записи «кто менял устройство» не должны терять автора при увольнении.
    is_active = Column(Boolean, nullable=False, server_default="true")
    # Взводится администратору, созданному при первом запуске, и после сброса
    # пароля другим админом: пока флаг стоит, интерфейс требует сменить пароль.
    must_change_password = Column(Boolean, nullable=False, server_default="false")
    # Подряд идущие неудачные попытки входа и время, до которого вход
    # закрыт. Внутренняя сеть — не повод раздавать неограниченный перебор:
    # подобрать пароль к учётке админа иначе можно скриптом за вечер.
    failed_logins = Column(Integer, nullable=False, server_default="0")
    locked_until = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (CheckConstraint("role IN ('admin','editor','viewer')"),)


class DeviceType(Base):
    """Категория устройства (Коммутатор, Сервер...). code_prefix используется
    для автогенерации кода устройства (SW-0001, SRV-0002...)."""
    __tablename__ = "device_types"
    id = Column(Integer, primary_key=True)
    name = Column(Text, unique=True, nullable=False)
    code_prefix = Column(Text, unique=True, nullable=False)

    templates = relationship("DeviceTemplate", back_populates="device_type")


class CodeSequence(Base):
    """Счётчик для генерации читаемых кодов устройств — по одному значению
    на префикс типа устройства."""
    __tablename__ = "code_sequences"
    prefix = Column(Text, primary_key=True)
    next_value = Column(Integer, nullable=False, default=1)


class Vlan(Base):
    """VLAN площадки. Номера у фабрик свои и спокойно совпадают: VLAN 10 на
    одной и на другой — разные сети."""
    __tablename__ = "vlans"
    id = Column(Integer, primary_key=True)
    site_id = Column(Integer, ForeignKey("sites.id", ondelete="CASCADE"), nullable=False, index=True)
    vlan_number = Column(Integer, nullable=False)
    name = Column(Text)
    subnet = Column(CIDR)
    gateway = Column(INET)
    dhcp_range = Column(Text)
    notes = Column(Text)

    __table_args__ = (
        UniqueConstraint("site_id", "vlan_number"),
        # Цель — не запрет дублей (id и так первичный ключ), а мишень для
        # составного внешнего ключа с портов: без такой уникальности
        # PostgreSQL не даст сослаться на пару (id, site_id).
        UniqueConstraint("id", "site_id", name="uq_vlans_site"),
    )


class DeviceTemplate(Base):
    """Шаблон устройства — описание модели техники: категория + набор
    портов. Заводится один раз для модели, а устройства в спецификации
    оборудования ссылаются на него и получают его порты при создании."""
    __tablename__ = "device_templates"
    id = Column(Integer, primary_key=True)
    name = Column(Text, nullable=False)
    device_type_id = Column(Integer, ForeignKey("device_types.id"), nullable=False)
    manufacturer = Column(Text)
    notes = Column(Text)
    # Цвет узла на схеме. Задаётся на модели техники, а не на устройстве:
    # одна настройка красит все «Cisco Catalyst 2960» разом.
    color = Column(Text)
    # Состав портов обычно определяется моделью и правится в шаблоне. Но у
    # части техники он меняется в жизни: в ПК доставили или сняли сетевую
    # карту. Для таких моделей флаг разрешает править порты у конкретного
    # устройства.
    ports_editable_on_device = Column(Boolean, nullable=False, server_default="false")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    device_type = relationship("DeviceType", back_populates="templates")
    # Порты отдаются в порядке гнёзд, а не в порядке заведения в базе:
    # человек читает их так же, как смотрит на переднюю панель.
    interfaces = relationship(
        "InterfaceTemplate", back_populates="template", cascade="all, delete-orphan",
        order_by="InterfaceTemplate.port_number",
    )
    devices = relationship("Device", back_populates="template")


class InterfaceTemplate(Base):
    """Порт, который есть у данной модели устройства. Копируется в
    interfaces при добавлении устройства в спецификацию оборудования."""
    __tablename__ = "device_template_interfaces"
    id = Column(Integer, primary_key=True)
    template_id = Column(Integer, ForeignKey("device_templates.id", ondelete="CASCADE"), nullable=False)
    # Номер порта — то, чем порт опознаётся: он напечатан на корпусе и по нему
    # человек находит гнездо. Название («Gi0/1», «eth0») — просто подпись,
    # у разных портов она может совпадать.
    port_number = Column(Integer, nullable=False)
    label = Column(Text, nullable=False)
    # Разъём — свойство модели техники: у всех «Catalyst 2960» порт 25 это
    # SFP. Режима (доступ/транк) здесь намеренно нет: он настраивается на
    # конкретной железке и в модели ничего не значит.
    connector_id = Column(Integer, ForeignKey("connector_types.id", ondelete="SET NULL"))

    __table_args__ = (UniqueConstraint("template_id", "port_number"),)

    template = relationship("DeviceTemplate", back_populates="interfaces")
    connector = relationship("ConnectorType")


class ConnectorType(Base):
    """Разъём порта — то, что физически торчит из железки.

    Разъёмы бывают двух сортов, и разница существенная: в RJ45 или LC кабель
    втыкается напрямую, а SFP — это клетка (слот), и разъём у неё появляется
    только вместе с модулем. Поэтому `is_cage` — не украшение, а признак,
    по которому у порта устройства спрашивают модуль.

    Справочник редактируемый: на заводе встречается M12, RS-485 и прочее, что
    в закрытый список в коде пришлось бы дописывать релизом.
    """
    __tablename__ = "connector_types"
    id = Column(Integer, primary_key=True)
    name = Column(Text, unique=True, nullable=False)
    # Среда: по ней потом видно, что медный патч-корд воткнут в оптику.
    media = Column(Text, nullable=False, default="copper")
    is_cage = Column(Boolean, nullable=False, server_default="false")

    __table_args__ = (CheckConstraint("media IN ('copper','fiber','other')"),)


class TransceiverModule(Base):
    """Модуль (трансивер), вставляемый в клетку: SFP, SFP+ и подобные.

    Держим справочником, а не строкой у порта: завод обычно стандартизуется
    на нескольких партномерах, и выбирать из списка быстрее и надёжнее, чем
    набирать текст. `connector_id` — разъём, который модуль даёт наружу
    (LC у оптики, RJ45 у медного SFP); именно он и есть настоящий разъём
    порта, когда модуль вставлен.
    """
    __tablename__ = "transceiver_modules"
    id = Column(Integer, primary_key=True)
    name = Column(Text, unique=True, nullable=False)
    # В какую клетку вставляется (SFP, SFP+...). Пусто — не уточняли.
    cage_connector_id = Column(Integer, ForeignKey("connector_types.id", ondelete="SET NULL"))
    # Что даёт наружу (LC, RJ45...).
    connector_id = Column(Integer, ForeignKey("connector_types.id", ondelete="SET NULL"))
    notes = Column(Text)

    cage_connector = relationship("ConnectorType", foreign_keys=[cage_connector_id])
    connector = relationship("ConnectorType", foreign_keys=[connector_id])


class TopologyGroup(Base):
    """Группа устройств на топологии — отдельный от тегов параметр:
    ровно одна группа на устройство (или ни одной). Теги множественные и
    для группировки на схеме не годятся (неясно, в какую рамку класть
    устройство с двумя тегами) — это специально узкое поле только под
    визуальную кластеризацию на топологии.

    Группы вкладываются друг в друга (parent_id): цех — участок — линия.
    Устройство при этом принадлежит ровно одной, самой внутренней: рамки
    остальных охватывают его через вложенность, а не через вторую запись."""
    __tablename__ = "topology_groups"
    id = Column(Integer, primary_key=True)
    site_id = Column(Integer, ForeignKey("sites.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(Text, nullable=False)
    color = Column(Text)
    # Удаление родителя не должно уносить с собой устройства вложенных
    # групп — подгруппы просто всплывают на уровень выше.
    parent_id = Column(Integer, ForeignKey("topology_groups.id", ondelete="SET NULL"), index=True)
    # Положение и размер рамки на схеме — в тех же координатах, что и
    # устройства. Рамка не подгоняется под содержимое: её двигают и тянут
    # руками, как область на плане цеха, а устройства живут внутри неё.
    # Пусто у групп, заведённых до появления этой правки — им рамка
    # считается по содержимому, пока её первый раз не подвинут.
    x = Column(Float)
    y = Column(Float)
    width = Column(Float)
    height = Column(Float)

    __table_args__ = (
        UniqueConstraint("site_id", "name"),
        # Мишень для составного ключа с устройств — см. комментарий у vlans.
        UniqueConstraint("id", "site_id", name="uq_topology_groups_site"),
    )

    parent = relationship("TopologyGroup", remote_side=[id], backref="children")
    # Только для чтения и по одному id: площадка у группы и устройства и так
    # совпадает — это держит составной ключ. Пиши SQLAlchemy сюда сама, она
    # при отвязке от группы обнулила бы вместе со ссылкой и site_id, который
    # входит в тот же составной ключ.
    devices = relationship(
        "Device", back_populates="topology_group", viewonly=True,
        primaryjoin="TopologyGroup.id == Device.topology_group_id",
        foreign_keys="Device.topology_group_id",
    )


class Device(Base):
    """Устройство в спецификации оборудования — экземпляр шаблона.
    code генерируется автоматически, name необязательно."""
    __tablename__ = "devices"
    id = Column(Integer, primary_key=True)
    site_id = Column(Integer, ForeignKey("sites.id", ondelete="CASCADE"), nullable=False, index=True)
    template_id = Column(Integer, ForeignKey("device_templates.id"), nullable=False)
    # Код остаётся уникальным на всю систему, а не на площадку: «упал SW-0042»
    # должно звучать однозначно, и сквозной поиск обязан давать один ответ.
    code = Column(Text, unique=True, nullable=False)
    name = Column(Text)
    management_ip = Column(INET)
    location = Column(Text)
    role = Column(Text)
    install_date = Column(Date)
    notes = Column(Text)
    topology_group_id = Column(Integer)
    topology_x = Column(Float)
    topology_y = Column(Float)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("role IN ('core','distribution','access') OR role IS NULL"),
        # Мишень для составного ключа с портов.
        UniqueConstraint("id", "site_id", name="uq_devices_site"),
        # Группа — только своей площадки. Ключ составной, поэтому чужую
        # группу устройству не назначить даже прямым UPDATE.
        #
        # В базе у этого ключа `ON DELETE SET NULL (topology_group_id)`
        # (PostgreSQL 15+, см. миграцию 0012): обнуляется ссылка на группу, а
        # площадка устройства остаётся — она NOT NULL. Здесь перечисление
        # колонки не пишется намеренно: PostgreSQL при чтении схемы его не
        # возвращает, и `alembic check` видел бы вечное расхождение там, где
        # его нет.
        ForeignKeyConstraint(
            ["topology_group_id", "site_id"], ["topology_groups.id", "topology_groups.site_id"],
            ondelete="SET NULL", name="fk_devices_group_site",
        ),
    )

    template = relationship("DeviceTemplate", back_populates="devices")
    interfaces = relationship(
        "Interface", back_populates="device", cascade="all, delete-orphan",
        order_by="Interface.port_number",
    )
    tags = relationship("Tag", secondary=device_tags, backref="devices")
    topology_group = relationship(
        "TopologyGroup", back_populates="devices", viewonly=True,
        primaryjoin="Device.topology_group_id == TopologyGroup.id",
        foreign_keys=topology_group_id,
    )


class Interface(Base):
    """Порт/интерфейс устройства. Статус (свободен/подключён) нигде не
    хранится — вычисляется по наличию связи в links."""
    __tablename__ = "interfaces"
    id = Column(Integer, primary_key=True)
    # Площадка дублируется с устройства намеренно: по ней составной внешний
    # ключ и держит порт при своей железке, а кабель — при портах одной
    # площадки.
    site_id = Column(Integer, ForeignKey("sites.id", ondelete="CASCADE"), nullable=False, index=True)
    device_id = Column(Integer, nullable=False)
    # Уникален номер, а не название: два порта могут называться одинаково,
    # но занимать разные гнёзда. Связь всегда указывает на конкретное гнездо.
    port_number = Column(Integer, nullable=False)
    label = Column(Text, nullable=False)
    # Из какого порта модели этот порт скопирован. Пусто — порт заведён
    # руками на устройстве со съёмными картами.
    #
    # Раньше порт модели и порт устройства сопоставлялись по номеру, и это
    # разъезжалось: сняли на ПК вторую карту, номера сомкнулись — и правка
    # порта №2 в модели переименовывала на этом ПК уже другой порт. Ссылка
    # не сдвигается вместе с номерами.
    template_interface_id = Column(
        Integer, ForeignKey("device_template_interfaces.id", ondelete="SET NULL"), index=True,
    )
    # Разъём приходит из модели и правится там же; у портов, заведённых
    # руками на устройстве со съёмными картами, он свой.
    connector_id = Column(Integer, ForeignKey("connector_types.id", ondelete="SET NULL"))
    # Модуль, вставленный в клетку (SFP и подобные). У обычного разъёма
    # пусто — вставлять некуда.
    module_id = Column(Integer, ForeignKey("transceiver_modules.id", ondelete="SET NULL"))
    # Режим порта — настройка конкретной железки, а не модели: одинаковые
    # коммутаторы стоят в разных местах и настроены по-разному. Раньше поле
    # называлось port_type и жило ещё и в шаблоне, где ничего не значило.
    mode = Column(Text)
    vlan_id = Column(Integer)
    ip = Column(INET)
    mac = Column(MACADDR)
    notes = Column(Text)

    __table_args__ = (
        UniqueConstraint("device_id", "port_number", name="uq_interfaces_number"),
        CheckConstraint("mode IN ('access','trunk','uplink') OR mode IS NULL"),
        # Мишень для составного ключа со связей.
        UniqueConstraint("id", "site_id", name="uq_interfaces_site"),
        ForeignKeyConstraint(
            ["device_id", "site_id"], ["devices.id", "devices.site_id"],
            ondelete="CASCADE", name="fk_interfaces_device_site",
        ),
        ForeignKeyConstraint(
            ["vlan_id", "site_id"], ["vlans.id", "vlans.site_id"],
            # Про запись ondelete — см. комментарий у devices.
            ondelete="SET NULL", name="fk_interfaces_vlan_site",
        ),
    )

    device = relationship("Device", back_populates="interfaces")
    template_interface = relationship("InterfaceTemplate")
    connector = relationship("ConnectorType")
    module = relationship("TransceiverModule")
    trunk_vlans = relationship(
        "InterfaceTrunkVlan", cascade="all, delete-orphan", back_populates="interface",
    )


class InterfaceTrunkVlan(Base):
    """VLAN, разрешённый в транке порта.

    Отдельной таблицей, а не массивом чисел в колонке порта. Массив был
    единственным местом схемы, где ничего не проверялось: в него ложился и
    удалённый VLAN, и VLAN чужой площадки — база о таких значениях не знала
    вовсе. Здесь работают те же составные ключи, что и везде: `site_id`
    один на строку и сверяется сразу с портом и с VLAN, поэтому «транк
    только своей площадки» держит сама база, а удаление VLAN убирает его из
    транков само.
    """
    __tablename__ = "interface_trunk_vlans"
    interface_id = Column(Integer, primary_key=True)
    vlan_id = Column(Integer, primary_key=True)
    site_id = Column(Integer, ForeignKey("sites.id", ondelete="CASCADE"), nullable=False, index=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["interface_id", "site_id"], ["interfaces.id", "interfaces.site_id"],
            ondelete="CASCADE", name="fk_trunk_interface_site",
        ),
        ForeignKeyConstraint(
            ["vlan_id", "site_id"], ["vlans.id", "vlans.site_id"],
            ondelete="CASCADE", name="fk_trunk_vlan_site",
        ),
    )

    interface = relationship("Interface", back_populates="trunk_vlans")


class LinkTemplate(Base):
    """Пресет связи: тип среды передачи + категория кабеля + оформление на
    топологии (цвет, стиль линии). Длина и разъём — свойства конкретного
    отрезка кабеля, поэтому остаются на самой связи, а не в шаблоне."""
    __tablename__ = "link_templates"
    id = Column(Integer, primary_key=True)
    name = Column(Text, unique=True, nullable=False)
    media_type = Column(Text, nullable=False)
    cable_category = Column(Text)
    color = Column(Text, nullable=False, default="#888888")
    line_style = Column(Text, nullable=False, default="solid")

    __table_args__ = (
        CheckConstraint("media_type IN ('copper','fiber','wireless','dac','other')"),
        CheckConstraint("line_style IN ('solid','dashed','dotted')"),
    )


class Link(Base):
    __tablename__ = "links"
    id = Column(Integer, primary_key=True)
    # Концы связи могут пустовать: сняли с ПК сетевую карту — порт исчез, а
    # кабель остался и физически никуда не делся. Такой конец «подвешен»,
    # его подключают заново к новому порту. Поэтому ON DELETE SET NULL, а не
    # CASCADE: раньше удаление порта молча уносило и саму связь.
    site_id = Column(Integer, ForeignKey("sites.id", ondelete="CASCADE"), nullable=False, index=True)
    interface_a_id = Column(Integer, unique=True)
    interface_b_id = Column(Integer, unique=True)
    template_id = Column(Integer, ForeignKey("link_templates.id", ondelete="SET NULL"))
    connector_type = Column(Text)
    length_m = Column(Numeric(6, 1))
    speed_mbps = Column(Integer)
    source = Column(Text, nullable=False, default="manual")
    confirmed = Column(Boolean, nullable=False, default=True)
    last_seen_at = Column(DateTime(timezone=True))
    notes = Column(Text)
    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        # Строгое "меньше", а не "не равно": стороны связи нормализуются по
        # возрастанию id, поэтому одна и та же связь не может быть записана
        # ещё и зеркально. Приложение раскладывает A/B в этом порядке само,
        # база теперь это гарантирует. С пустым концом сравнение даёт NULL, и
        # ограничение не срабатывает — подвешенная связь проходит.
        CheckConstraint("interface_a_id < interface_b_id"),
        # Связь без обоих концов — мусор: удалять её нужно целиком.
        CheckConstraint("interface_a_id IS NOT NULL OR interface_b_id IS NOT NULL"),
        CheckConstraint("source IN ('manual','snmp','lldp')"),
        # Ради этих двух ключей всё и затевалось: кабель между портами разных
        # фабрик записать невозможно — ни ошибкой в коде, ни ручным INSERT.
        # В базе у обоих ключей `ON DELETE SET NULL (interface_?_id)`
        # (PostgreSQL 15+): снятый порт оставляет конец кабеля подвешенным, а
        # площадка кабеля сохраняется. Про запись ondelete здесь — см.
        # комментарий у devices.
        ForeignKeyConstraint(
            ["interface_a_id", "site_id"], ["interfaces.id", "interfaces.site_id"],
            ondelete="SET NULL", name="fk_links_a_site",
        ),
        ForeignKeyConstraint(
            ["interface_b_id", "site_id"], ["interfaces.id", "interfaces.site_id"],
            ondelete="SET NULL", name="fk_links_b_site",
        ),
    )

    # Только для чтения и по одному id — см. комментарий у TopologyGroup.devices.
    interface_a = relationship(
        "Interface", viewonly=True, foreign_keys=[interface_a_id],
        primaryjoin="Link.interface_a_id == Interface.id",
    )
    interface_b = relationship(
        "Interface", viewonly=True, foreign_keys=[interface_b_id],
        primaryjoin="Link.interface_b_id == Interface.id",
    )
    template = relationship("LinkTemplate")


class ImportRow(Base):
    """Строка из загруженного файла — до того, как стала устройством.

    Файл не заводит устройства сам: в нём бывают опечатки, неизвестные
    модели и наполовину пустые строки, а код устройства раздаётся системой.
    Поэтому строки сначала ложатся сюда, а человек переносит их по одной,
    видя в обычном окне устройства всё, что удалось разобрать. Пока строку
    не перенесли, в спецификации оборудования её нет.

    Значения хранятся как есть, текстом: в файле написано «Cisco 2960», а
    есть ли такая модель в справочнике — выясняется при переносе.
    """
    __tablename__ = "import_rows"
    id = Column(Integer, primary_key=True)
    # Файл загружают, работая на конкретной площадке, — туда строки и уедут.
    site_id = Column(Integer, ForeignKey("sites.id", ondelete="CASCADE"), nullable=False, index=True)
    source_file = Column(Text, nullable=False)
    row_number = Column(Integer, nullable=False)  # номер строки в файле, для сверки с оригиналом

    name = Column(Text)
    template_name = Column(Text)
    type_name = Column(Text)
    management_ip = Column(Text)
    location = Column(Text)
    notes = Column(Text)
    group_name = Column(Text)
    tags_text = Column(Text)
    # Колонки, которым не нашлось места в модели: серийники, инвентарные
    # номера и прочее. Не выбрасываем — человек видит их при переносе.
    extra = Column(JSON)

    # 'new' — ждёт переноса, 'moved' — стала устройством.
    status = Column(Text, nullable=False, server_default="new", index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="SET NULL"))
    imported_at = Column(DateTime(timezone=True), server_default=func.now())
    imported_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (CheckConstraint("status IN ('new','moved')"),)

    device = relationship("Device")


class AuditLog(Base):
    """Кто, что и когда менял.

    Площадка проставляется, если менялось что-то принадлежащее площадке
    (устройство, кабель, тег). У общих справочников — моделей техники,
    разъёмов, пресетов кабелей — и у действий с людьми она пустая: такие
    записи видны всем, потому что и сами справочники общие. Без этой колонки
    журнал обходил бы изоляцию: по нему было бы видно и чужие устройства.
    """
    __tablename__ = "audit_log"
    id = Column(BigInteger, primary_key=True)
    site_id = Column(Integer, ForeignKey("sites.id", ondelete="CASCADE"), index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    action = Column(Text, nullable=False)
    entity_type = Column(Text, nullable=False)
    entity_id = Column(Integer)
    old_value = Column(JSON)
    new_value = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    __table_args__ = (
        # Журнал листают либо целиком по времени, либо по конкретной записи
        # («что было с этим устройством») — под оба случая по индексу.
        Index("ix_audit_entity", "entity_type", "entity_id"),
    )
