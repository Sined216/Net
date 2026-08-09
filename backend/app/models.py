from sqlalchemy import (
    Column, Integer, BigInteger, Text, Boolean, Float, ForeignKey,
    CheckConstraint, UniqueConstraint, Numeric, Date, DateTime, ARRAY, JSON, Table,
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


class Tag(Base):
    """Тег для группировки устройств — вложенный (parent_id), устройство
    может иметь сразу несколько тегов. Пришёл на замену площадкам: место
    (или любая другая группировка — по критичности, по линии и т.п.)
    теперь просто тег, а не отдельная жёстко заданная сущность."""
    __tablename__ = "tags"
    id = Column(Integer, primary_key=True)
    name = Column(Text, nullable=False)
    parent_id = Column(Integer, ForeignKey("tags.id", ondelete="CASCADE"))
    color = Column(Text)

    __table_args__ = (UniqueConstraint("parent_id", "name"),)

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
    __tablename__ = "vlans"
    id = Column(Integer, primary_key=True)
    vlan_number = Column(Integer, unique=True, nullable=False)
    name = Column(Text)
    subnet = Column(CIDR)
    gateway = Column(INET)
    dhcp_range = Column(Text)
    notes = Column(Text)


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
    port_type = Column(Text)

    __table_args__ = (
        UniqueConstraint("template_id", "port_number"),
        CheckConstraint("port_type IN ('access','trunk','uplink') OR port_type IS NULL"),
    )

    template = relationship("DeviceTemplate", back_populates="interfaces")


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
    name = Column(Text, unique=True, nullable=False)
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

    parent = relationship("TopologyGroup", remote_side=[id], backref="children")
    devices = relationship("Device", back_populates="topology_group")


class Device(Base):
    """Устройство в спецификации оборудования — экземпляр шаблона.
    code генерируется автоматически, name необязательно."""
    __tablename__ = "devices"
    id = Column(Integer, primary_key=True)
    template_id = Column(Integer, ForeignKey("device_templates.id"), nullable=False)
    code = Column(Text, unique=True, nullable=False)
    name = Column(Text)
    management_ip = Column(INET)
    location = Column(Text)
    role = Column(Text)
    install_date = Column(Date)
    notes = Column(Text)
    topology_group_id = Column(Integer, ForeignKey("topology_groups.id", ondelete="SET NULL"))
    topology_x = Column(Float)
    topology_y = Column(Float)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (CheckConstraint("role IN ('core','distribution','access') OR role IS NULL"),)

    template = relationship("DeviceTemplate", back_populates="devices")
    interfaces = relationship(
        "Interface", back_populates="device", cascade="all, delete-orphan",
        order_by="Interface.port_number",
    )
    tags = relationship("Tag", secondary=device_tags, backref="devices")
    topology_group = relationship("TopologyGroup", back_populates="devices")


class Interface(Base):
    """Порт/интерфейс устройства. Статус (свободен/подключён) нигде не
    хранится — вычисляется по наличию связи в links."""
    __tablename__ = "interfaces"
    id = Column(Integer, primary_key=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    # Уникален номер, а не название: два порта могут называться одинаково,
    # но занимать разные гнёзда. Связь всегда указывает на конкретное гнездо.
    port_number = Column(Integer, nullable=False)
    label = Column(Text, nullable=False)
    port_type = Column(Text)
    vlan_id = Column(Integer, ForeignKey("vlans.id", ondelete="SET NULL"))
    trunk_vlan_ids = Column(ARRAY(Integer))
    ip = Column(INET)
    mac = Column(MACADDR)
    notes = Column(Text)

    __table_args__ = (
        UniqueConstraint("device_id", "port_number"),
        CheckConstraint("port_type IN ('access','trunk','uplink') OR port_type IS NULL"),
    )

    device = relationship("Device", back_populates="interfaces")


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
    interface_a_id = Column(Integer, ForeignKey("interfaces.id", ondelete="SET NULL"), unique=True)
    interface_b_id = Column(Integer, ForeignKey("interfaces.id", ondelete="SET NULL"), unique=True)
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
    )

    interface_a = relationship("Interface", foreign_keys=[interface_a_id])
    interface_b = relationship("Interface", foreign_keys=[interface_b_id])
    template = relationship("LinkTemplate")


class AuditLog(Base):
    __tablename__ = "audit_log"
    id = Column(BigInteger, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    action = Column(Text, nullable=False)
    entity_type = Column(Text, nullable=False)
    entity_id = Column(Integer)
    old_value = Column(JSON)
    new_value = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
