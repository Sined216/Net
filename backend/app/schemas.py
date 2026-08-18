from datetime import date, datetime
from typing import Literal, Optional, List
from pydantic import BaseModel, ConfigDict, Field

from app.fields import IPAddressStr, IPNetworkStr, MacAddressStr

# Перечисления держим здесь, а не только в CHECK-ограничениях базы: иначе
# опечатка в port_type доезжала до PostgreSQL и возвращалась пятисоткой
# вместо понятного 422 с перечнем допустимых значений.
Role = Literal["admin", "editor", "viewer"]
# Режим порта — настройка конкретной железки. Раньше поле называлось
# «тип порта»; слово «тип» теперь занято разъёмом, которому оно подходит.
PortMode = Literal["access", "trunk", "uplink"]
ConnectorMedia = Literal["copper", "fiber", "other"]
DeviceRole = Literal["core", "distribution", "access"]
MediaType = Literal["copper", "fiber", "wireless", "dac", "other"]
LineStyle = Literal["solid", "dashed", "dotted"]
LinkSource = Literal["manual", "snmp", "lldp"]


# ---------- Auth ----------
# Двенадцать символов — рекомендация OWASP для паролей без второго фактора.
# Требование длины, а не «одна заглавная и цифра»: длина даёт стойкость, а
# правила состава лишь толкают людей к «Password1!».
MIN_PASSWORD_LENGTH = 12
Password = Field(min_length=MIN_PASSWORD_LENGTH, max_length=128)


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    username: str = Field(min_length=1, max_length=100)
    password: str = Password
    role: Role = "viewer"


class UserUpdate(BaseModel):
    """Правка чужой учётной записи администратором. Пароль сюда не входит —
    для него отдельный эндпоинт, чтобы случайная отправка формы не сбрасывала
    его молча."""
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    role: Optional[Role] = None
    is_active: Optional[bool] = None


class PasswordChange(BaseModel):
    """Смена своего пароля. Текущий спрашивается, чтобы уведённой сессией
    нельзя было отобрать учётную запись у владельца."""
    current_password: str
    new_password: str = Password


class PasswordReset(BaseModel):
    """Сброс пароля администратором: текущий он не знает, поэтому не
    спрашивается. Пользователю ставится требование сменить пароль."""
    new_password: str = Password


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    full_name: str
    username: str
    role: Role
    is_active: bool
    must_change_password: bool
    created_at: datetime


class LoginRequest(BaseModel):
    username: str
    password: str


# ---------- Журнал изменений ----------
class AuditChange(BaseModel):
    """Одно изменённое поле — уже разобранное на «было» и «стало».

    Разбор делает сервер, а не интерфейс: сравнивать два снимка столбцов —
    работа над данными, и делать её в каждом клиенте заново незачем.
    """
    field: str
    label: str
    old: Optional[str] = None
    new: Optional[str] = None


class AuditEntryOut(BaseModel):
    id: int
    action: str
    entity_type: str
    entity_label: str
    entity_id: Optional[int] = None
    user_id: Optional[int] = None
    user_name: Optional[str] = None
    created_at: datetime
    changes: list[AuditChange] = []


class AuditPage(BaseModel):
    """Страница журнала. Всего записей — чтобы интерфейс знал, есть ли ещё."""
    items: list[AuditEntryOut]
    total: int


# ---------- Площадка (фабрика) ----------
class SiteCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=2000)


class SiteUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=2000)


class SiteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    notes: Optional[str] = None


class SiteAccessUpdate(BaseModel):
    """Кому доступна площадка. Список целиком, а не по одному: так видно, кто
    останется, и не нужен отдельный маршрут на отзыв."""
    user_ids: list[int]


# ---------- Tag (вложенный, вместо площадок) ----------
class TagBase(BaseModel):
    """Общая часть. Ограничения длины живут в схемах ввода, а не здесь:
    иначе они попадают и в ответ, и запись, заведённая до появления
    ограничения, перестаёт читаться — список отдаёт 500 вместо данных."""
    name: str
    parent_id: Optional[int] = None
    color: Optional[str] = None


class TagCreate(TagBase):
    name: str = Field(min_length=1, max_length=100)


class TagUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    parent_id: Optional[int] = None
    color: Optional[str] = None


class TagOut(TagBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ---------- Topology group (отдельный от тегов параметр: одна группа на
# устройство — только для визуальной кластеризации на топологии; группы
# вкладываются друг в друга: цех — участок — линия) ----------
class TopologyGroupBox(BaseModel):
    """Положение и размер рамки на схеме. Рамку двигают и тянут руками —
    под содержимое она не подгоняется."""
    x: float
    y: float
    width: float = Field(gt=0)
    height: float = Field(gt=0)


GroupKind = Literal["area", "cabinet"]


class TopologyGroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: Optional[str] = None
    # Группа внутри группы: цех — участок — линия.
    parent_id: Optional[int] = None
    # Обычная рамка или шкаф — реальная железка, а не область на плане.
    # У шкафа не бывает подгрупп: см. проверку в роутере.
    kind: GroupKind = "area"


class TopologyGroupUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    color: Optional[str] = None
    parent_id: Optional[int] = None
    kind: Optional[GroupKind] = None


class TopologyGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    color: Optional[str] = None
    parent_id: Optional[int] = None
    kind: GroupKind = "area"
    # Пусто, пока рамку ни разу не двигали: тогда она считается по
    # содержимому, как было до появления ручной правки.
    x: Optional[float] = None
    y: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    # Сколько устройств лежит прямо в этой группе (без подгрупп). Считает
    # база: список групп показывает эту цифру, и везти ради неё все
    # устройства площадки было бы странно.
    device_count: int = 0


# ---------- Импорт устройств из файла ----------
class ImportRowOut(BaseModel):
    """Строка из файла и то, что удалось по ней опознать.

    Подсказки (`suggested_*`) — это найденные по названию записи
    справочников. Ничего не решают: человек видит их подставленными в окне
    устройства и правит, если файл врёт."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    source_file: str
    row_number: int
    name: Optional[str] = None
    template_name: Optional[str] = None
    type_name: Optional[str] = None
    management_ip: Optional[str] = None
    mac: Optional[str] = None
    notes: Optional[str] = None
    group_name: Optional[str] = None
    tags_text: Optional[str] = None
    extra: Optional[dict] = None
    status: str
    device_id: Optional[int] = None
    imported_at: Optional[datetime] = None

    suggested_template_id: Optional[int] = None
    suggested_group_id: Optional[int] = None
    suggested_tag_ids: List[int] = []

    # Уже заведённое устройство с тем же названием, адресом или MAC. Не
    # запрет: в файле встречается и то, что в базе уже есть, — но человек
    # должен видеть это до переноса, а не заводить второе такое же.
    same_name_device_id: Optional[int] = None
    same_ip_device_id: Optional[int] = None
    same_mac_device_id: Optional[int] = None


class ImportSummary(BaseModel):
    """Что вышло из загрузки файла."""
    file: str
    added: int
    skipped_empty: int


# ---------- Device type (категория устройства) ----------
class DeviceTypeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    code_prefix: str = Field(min_length=1, max_length=10)


class DeviceTypeUpdate(BaseModel):
    """Правка типа. Смена префикса действует только на будущие устройства:
    коды уже заведённых напечатаны на наклейках и не переписываются."""
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    code_prefix: Optional[str] = Field(default=None, min_length=1, max_length=10)


class DeviceTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    code_prefix: str


# ---------- Разъёмы и модули ----------
class ConnectorTypeBase(BaseModel):
    name: str
    media: ConnectorMedia = "copper"
    # Клетка (SFP и подобные): разъём у неё появляется вместе с модулем.
    is_cage: bool = False


class ConnectorTypeCreate(ConnectorTypeBase):
    name: str = Field(min_length=1, max_length=50)


class ConnectorTypeUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=50)
    media: Optional[ConnectorMedia] = None
    is_cage: Optional[bool] = None


class ConnectorTypeOut(ConnectorTypeBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


class TransceiverModuleBase(BaseModel):
    name: str
    # В какую клетку вставляется и что даёт наружу.
    cage_connector_id: Optional[int] = None
    connector_id: Optional[int] = None
    notes: Optional[str] = None


class TransceiverModuleCreate(TransceiverModuleBase):
    name: str = Field(min_length=1, max_length=100)


class TransceiverModuleUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    cage_connector_id: Optional[int] = None
    connector_id: Optional[int] = None
    notes: Optional[str] = None


class TransceiverModuleOut(TransceiverModuleBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ---------- VLAN ----------
class VlanBase(BaseModel):
    vlan_number: int
    name: Optional[str] = None
    subnet: Optional[IPNetworkStr] = None
    gateway: Optional[IPAddressStr] = None
    dhcp_range: Optional[str] = None
    notes: Optional[str] = None


class VlanCreate(VlanBase):
    # 802.1Q: номера 1..4094, ноль и 4095 зарезервированы стандартом.
    vlan_number: int = Field(ge=1, le=4094)
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)


class VlanUpdate(BaseModel):
    """Опечатка в номере или подсети раньше лечилась только удалением VLAN
    и заведением заново — с потерей DHCP-диапазона и заметок, если их
    забыли переписать вручную. Здесь то же самое можно поправить на месте."""
    vlan_number: Optional[int] = Field(default=None, ge=1, le=4094)
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    subnet: Optional[IPNetworkStr] = None
    gateway: Optional[IPAddressStr] = None
    dhcp_range: Optional[str] = None
    notes: Optional[str] = None


class VlanOut(VlanBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ---------- Interface template (порт в шаблоне устройства) ----------
class InterfaceTemplateBase(BaseModel):
    label: str
    # Разъём — свойство модели. Пусто допустимо (не уточняли), но по
    # умолчанию интерфейс подставляет RJ45.
    connector_id: Optional[int] = None


class InterfaceTemplateCreate(InterfaceTemplateBase):
    """Номер не передаётся: порты нумеруются подряд, новый встаёт в конец."""
    label: str = Field(min_length=1, max_length=100)


class PortsBulkCreate(BaseModel):
    """Сразу пачка портов: «сделай мне 24 штуки».

    Отдельным запросом, а не двумя десятками параллельных: номер порта
    вычисляется от текущего максимума, и одновременные запросы читают один
    и тот же максимум — часть из них отбивается уникальным индексом, и
    вместо 24 портов появляется два.
    """
    count: int = Field(ge=1, le=96)
    connector_id: Optional[int] = None


class InterfaceTemplateUpdate(BaseModel):
    """Правка порта модели. Название и разъём разъезжаются по всем её
    устройствам: порт устройства — копия порта модели."""
    label: Optional[str] = Field(default=None, min_length=1, max_length=100)
    connector_id: Optional[int] = None


class InterfaceTemplateOut(InterfaceTemplateBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    # Номер — место порта в ряду гнёзд, им порт и опознаётся. Ряд всегда
    # сплошной, поэтому номер назначает сервер, а не пользователь.
    port_number: int


# ---------- Device template (шаблон устройства/модель) ----------
class DeviceTemplateBase(BaseModel):
    name: str
    device_type_id: int
    manufacturer: Optional[str] = None
    notes: Optional[str] = None
    # Цвет узла на схеме; пусто — узел рисуется нейтральным.
    color: Optional[str] = None
    # Разрешить менять состав портов у конкретного устройства (ПК, куда
    # доставили сетевую карту). По умолчанию порты задаёт только шаблон.
    ports_editable_on_device: bool = False


class DeviceTemplateCreate(DeviceTemplateBase):
    name: str = Field(min_length=1, max_length=200)
    interfaces: List[InterfaceTemplateCreate] = []


class DeviceTemplateUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    device_type_id: Optional[int] = None
    manufacturer: Optional[str] = None
    notes: Optional[str] = None
    color: Optional[str] = None
    ports_editable_on_device: Optional[bool] = None


class TemplateImpact(BaseModel):
    """Что заденет правка портов модели: сколько устройств заведено по ней и
    сколько их портов уже подключено кабелем."""
    devices: int
    connected_ports: int


class DeviceTemplateOut(DeviceTemplateBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    interfaces: List[InterfaceTemplateOut] = []
    # Сколько железок этой модели заведено на текущей площадке. Сам шаблон
    # общий для всех площадок, а счёт — местный: он отвечает на вопрос «что
    # у нас стоит», а не «что бывает на свете».
    devices_count: int = 0


# ---------- Interface ----------
class InterfaceUpdate(BaseModel):
    """Правка порта у конкретного устройства.

    Ни названия, ни номера здесь нет: они описывают саму модель техники и
    правятся в шаблоне — иначе одинаковые железки разъезжаются по названиям
    портов. Здесь настраивается то, что у каждого экземпляра своё: адреса,
    VLAN, заметка.
    """
    # Номер правки, который клиент видел на экране. Расхождение с текущим
    # значит, что кто-то сохранил раньше, — см. app/versioning.py. Пусто —
    # проверки нет: так ведут себя старые клиенты и служебные вызовы.
    version: Optional[int] = None
    mode: Optional[PortMode] = None
    # Модуль, вставленный в клетку. Разъём здесь не правится — он из модели.
    module_id: Optional[int] = None
    vlan_id: Optional[int] = None
    trunk_vlan_ids: Optional[List[int]] = None
    ip: Optional[IPAddressStr] = None
    mac: Optional[MacAddressStr] = None
    notes: Optional[str] = None


class InterfaceCreate(BaseModel):
    """Добавление порта устройству — только для моделей со съёмными портами.

    Номер не передаётся: порт встаёт в конец ряда."""
    label: str = Field(min_length=1, max_length=100)
    connector_id: Optional[int] = None
    mode: Optional[PortMode] = None
    module_id: Optional[int] = None
    vlan_id: Optional[int] = None
    ip: Optional[IPAddressStr] = None
    mac: Optional[MacAddressStr] = None
    notes: Optional[str] = None


class ConnectedTo(BaseModel):
    """Куда подключён порт — вычисляется по наличию связи, нигде не хранится."""
    link_id: int
    device_id: int
    device_code: str
    device_name: Optional[str] = None
    interface_id: int
    interface_label: str


class InterfaceOut(BaseModel):
    id: int
    device_id: int
    version: int = 1
    port_number: int
    label: str
    mode: Optional[PortMode] = None
    # Разъём порта и вставленный модуль. `connector_effective` — то, что
    # реально торчит наружу: разъём модуля, если он вставлен, иначе свой.
    connector: Optional[ConnectorTypeOut] = None
    module: Optional[TransceiverModuleOut] = None
    connector_effective: Optional[ConnectorTypeOut] = None
    # Клетка без модуля: порт есть, а воткнуть в него нечего.
    empty_cage: bool = False
    vlan_id: Optional[int] = None
    trunk_vlan_ids: Optional[List[int]] = None
    ip: Optional[IPAddressStr] = None
    mac: Optional[MacAddressStr] = None
    notes: Optional[str] = None
    # Связь, в которой участвует порт. Есть даже когда второй конец подвешен,
    # поэтому свободен порт ровно тогда, когда link_id пуст.
    link_id: Optional[int] = None
    connected_to: Optional[ConnectedTo] = None


# ---------- Device (устройство в спецификации оборудования) ----------
class DeviceBase(BaseModel):
    template_id: int
    name: Optional[str] = None
    management_ip: Optional[IPAddressStr] = None
    # Управляющий MAC железки — не MAC порта: по нему устройство ищут в
    # таблицах коммутации соседей, и к конкретному гнезду он не привязан.
    mac: Optional[MacAddressStr] = None
    role: Optional[DeviceRole] = None
    install_date: Optional[date] = None
    notes: Optional[str] = None
    topology_group_id: Optional[int] = None


class DeviceCreate(DeviceBase):
    # Длины — только на вводе: DeviceOut наследует DeviceBase, и ограничение
    # там сделало бы нечитаемой запись, заведённую раньше.
    name: Optional[str] = Field(default=None, max_length=200)
    tag_ids: List[int] = []


class DeviceUpdate(BaseModel):
    # Номер правки, который клиент видел на экране. Расхождение с текущим
    # значит, что кто-то сохранил раньше, — см. app/versioning.py. Пусто —
    # проверки нет: так ведут себя старые клиенты и служебные вызовы.
    version: Optional[int] = None
    name: Optional[str] = Field(default=None, max_length=200)
    management_ip: Optional[IPAddressStr] = None
    mac: Optional[MacAddressStr] = None
    role: Optional[DeviceRole] = None
    install_date: Optional[date] = None
    notes: Optional[str] = None
    topology_group_id: Optional[int] = None


class DeviceListItem(BaseModel):
    """Устройство в списке — без портов.

    Порты составляют почти весь вес ответа: на тысяче устройств по 24 порта
    это двадцать четыре тысячи вложенных объектов, и список открывается
    минутами. В списке они не нужны: видно, сколько всего и сколько занято, а
    сами порты подтягиваются, когда карточку раскрывают.
    """
    model_config = ConfigDict(from_attributes=True)
    id: int
    version: int = 1
    template_id: int
    code: str
    name: Optional[str] = None
    management_ip: Optional[str] = None
    mac: Optional[str] = None
    role: Optional[DeviceRole] = None
    install_date: Optional[date] = None
    notes: Optional[str] = None
    topology_group_id: Optional[int] = None
    topology_x: Optional[float] = None
    topology_y: Optional[float] = None
    ports_total: int = 0
    ports_connected: int = 0
    tags: List[TagOut] = []


class DevicePage(BaseModel):
    items: List[DeviceListItem]
    total: int


class LinkEndOut(BaseModel):
    """Конец кабеля — сразу с подписями.

    Иначе страница связей вынуждена держать в памяти все устройства со всеми
    портами только ради того, чтобы вместо «интерфейс 4312» написать
    «SW-0003 · №2 Gi0/2».
    """
    device_id: int
    device_code: str
    device_name: Optional[str] = None
    # Модель техники — устройств одного кода на схеме бывает много, а
    # угадать нужное по одному лишь коду и произвольному имени трудно.
    device_template_name: Optional[str] = None
    interface_id: int
    interface_label: str
    port_number: int


class FreePortOut(BaseModel):
    """Свободный порт для выпадающего списка подключения."""
    interface_id: int
    label: str
    port_number: int
    device_id: int
    device_code: str
    device_name: Optional[str] = None
    device_template_name: Optional[str] = None


class DeviceTagsUpdate(BaseModel):
    tag_ids: List[int]
    # Номер правки, который клиент видел на экране. Расхождение с текущим
    # значит, что кто-то сохранил раньше, — см. app/versioning.py. Пусто —
    # проверки нет: так ведут себя старые клиенты и служебные вызовы.
    version: Optional[int] = None



class DevicePositionUpdate(BaseModel):
    """Позиция узла на топологии — сохраняется отдельно от общей формы
    редактирования устройства, обновляется при перетаскивании узла."""
    x: float
    y: float


class DevicePosition(DevicePositionUpdate):
    """То же, но с указанием, чьё это место: для записи сразу нескольких."""
    id: int


class DevicePositionsUpdate(BaseModel):
    """Расположение нескольких узлов сразу — результат автоматической
    раскладки схемы. Ограничение сверху не столько от злого умысла, сколько
    от опечатки в клиенте: схема на площадке больше пяти тысяч устройств не
    рисуется в любом случае."""
    positions: List[DevicePosition] = Field(default_factory=list, max_length=5000)


class DeviceOut(DeviceBase):
    id: int
    code: str
    created_at: datetime
    updated_at: datetime
    # Номер правки: клиент возвращает его при сохранении, и по нему видно,
    # не успел ли кто-то другой.
    version: int = 1
    interfaces: List[InterfaceOut] = []
    tags: List[TagOut] = []
    topology_x: Optional[float] = None
    topology_y: Optional[float] = None


# ---------- Link template (пресет: среда + кабель + оформление на топологии) ----------
class LinkTemplateBase(BaseModel):
    name: str
    media_type: MediaType
    cable_category: Optional[str] = None
    color: str = "#888888"
    line_style: LineStyle = "solid"


class LinkTemplateCreate(LinkTemplateBase):
    name: str = Field(min_length=1, max_length=100)


class LinkTemplateUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    media_type: Optional[MediaType] = None
    cable_category: Optional[str] = None
    color: Optional[str] = None
    line_style: Optional[LineStyle] = None


class LinkTemplateOut(LinkTemplateBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ---------- Link ----------
class LinkCreate(BaseModel):
    interface_a_id: int
    interface_b_id: int
    template_id: Optional[int] = None
    connector_type: Optional[str] = None
    # NUMERIC(6,1) в базе: больше 99999.9 не влезает, а отрицательной длины
    # кабеля не бывает. Без этого слишком большое число доезжало до базы и
    # возвращалось пятисоткой.
    length_m: Optional[float] = Field(default=None, ge=0, le=99999.9)
    speed_mbps: Optional[int] = Field(default=None, ge=0, le=1_000_000)
    notes: Optional[str] = None
    # source и confirmed клиент не задаёт: связь, созданную руками, сервер
    # всегда помечает manual/подтверждена. Поля существуют под будущий
    # SNMP/LLDP-опрос, который будет заводить связи от своего имени и с
    # confirmed=false до проверки человеком.


class LinkUpdate(BaseModel):
    # Номер правки, который клиент видел на экране. Расхождение с текущим
    # значит, что кто-то сохранил раньше, — см. app/versioning.py. Пусто —
    # проверки нет: так ведут себя старые клиенты и служебные вызовы.
    version: Optional[int] = None
    template_id: Optional[int] = None
    connector_type: Optional[str] = None
    # NUMERIC(6,1) в базе: больше 99999.9 не влезает, а отрицательной длины
    # кабеля не бывает. Без этого слишком большое число доезжало до базы и
    # возвращалось пятисоткой.
    length_m: Optional[float] = Field(default=None, ge=0, le=99999.9)
    speed_mbps: Optional[int] = Field(default=None, ge=0, le=1_000_000)
    # confirmed клиент не задаёт — та же оговорка, что у LinkCreate.source
    # и .confirmed выше: это поле под будущий SNMP/LLDP-опрос, который
    # будет сам решать, подтверждена ли связь, а не человек через форму.
    notes: Optional[str] = None


class LinkAttach(BaseModel):
    """Подключение подвешенного конца связи к порту: поставили новую сетевую
    карту — воткнули в неё тот же кабель."""
    interface_id: int


class LinkReconnect(BaseModel):
    """Перестановка конца кабеля в другой порт: воткнули не туда, или
    железку перекоммутировали. Конец называется портом, в котором он сейчас
    сидит, а не буквой «A»/«B»: стороны хранятся по возрастанию id и при
    перестановке могут поменяться местами."""
    from_interface_id: int
    to_interface_id: int


class LinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    # Концы с подписями: пусто, если конец подвешен.
    end_a: Optional["LinkEndOut"] = None
    end_b: Optional["LinkEndOut"] = None
    # Пустой конец — «подвешенный»: порт, в который был воткнут кабель,
    # удалили, а сам кабель остался.
    interface_a_id: Optional[int] = None
    interface_b_id: Optional[int] = None
    template_id: Optional[int] = None
    connector_type: Optional[str] = None
    length_m: Optional[float] = None
    speed_mbps: Optional[int] = None
    source: LinkSource
    confirmed: bool
    notes: Optional[str] = None
    updated_at: datetime
    version: int = 1


# ---------- Topology (для визуализации) ----------
class TopologyNode(BaseModel):
    """Устройство глазами схемы: ровно те поля, которые видны на карточке.

    Портов здесь нет намеренно — только их количество. Схема показывает
    «1/4», а не список; возить ради этой дроби все двадцать четыре тысячи
    портов площадки было единственным по-настоящему тяжёлым запросом в
    системе.
    """
    id: int
    code: str
    name: Optional[str] = None
    # Адрес управления — строкой на карточке, по настройке вида: наладчику
    # он нужен, чтобы зайти на железку прямо со схемы, не открывая карточку.
    management_ip: Optional[str] = None
    template_id: Optional[int] = None
    template_name: str
    # Производитель берётся из модели: на карточке его показывают рядом с
    # названием модели, и запрашивать ради этого весь список шаблонов
    # (со всеми их портами) незачем.
    manufacturer: Optional[str] = None
    device_type: str
    # Цвет модели — им красится рамка карточки. Раньше схема ради него
    # тянула весь список шаблонов со всеми их портами.
    color: Optional[str] = None
    tag_ids: List[int] = []
    topology_group_id: Optional[int] = None
    topology_x: Optional[float] = None
    topology_y: Optional[float] = None
    ports_total: int = 0
    ports_connected: int = 0


class TopologyEdge(BaseModel):
    """Кабель глазами схемы.

    Устройство и порт у конца могут отсутствовать: порт удалили, а кабель
    остался. Такой конец схема рисует заглушкой, поэтому пропускать связь
    нельзя — иначе повисший кабель просто исчезал бы с картинки.
    """
    link_id: int
    device_a_id: Optional[int] = None
    device_b_id: Optional[int] = None
    interface_a_id: Optional[int] = None
    interface_b_id: Optional[int] = None
    port_a_number: Optional[int] = None
    port_b_number: Optional[int] = None
    interface_a_label: Optional[str] = None
    interface_b_label: Optional[str] = None
    media_type: Optional[str] = None
    color: Optional[str] = None
    line_style: Optional[str] = None
    confirmed: bool


class TopologyOut(BaseModel):
    nodes: List[TopologyNode]
    edges: List[TopologyEdge]


class LinkPage(BaseModel):
    items: List[LinkOut]
    total: int


# ---------- Структура БД ----------
class SchemaColumn(BaseModel):
    name: str
    type: str
    nullable: bool
    primary_key: bool
    unique: bool
    # «таблица.колонка», куда указывает внешний ключ; пусто, если это не он.
    references: Optional[str] = None


class SchemaTable(BaseModel):
    name: str
    note: Optional[str] = None
    columns: List[SchemaColumn]
    row_count: int


class DatabaseSchema(BaseModel):
    tables: List[SchemaTable]


# ---------- Search ----------
class SearchResult(BaseModel):
    device_id: int
    device_code: str
    device_name: Optional[str] = None
    # Пусто у строки, найденной по самому устройству (имя, код, его IP или
    # MAC) — искали не порт, показывать какой-то один было бы обманом.
    # Заполнено у строки, найденной по IP или MAC конкретного гнезда.
    interface_id: Optional[int] = None
    interface_label: Optional[str] = None
    ip: Optional[str] = None
    mac: Optional[str] = None
