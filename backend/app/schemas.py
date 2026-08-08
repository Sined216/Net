from datetime import date, datetime
from typing import Literal, Optional, List
from pydantic import BaseModel, ConfigDict, Field

from app.fields import IPAddressStr, IPNetworkStr, MacAddressStr

# Перечисления держим здесь, а не только в CHECK-ограничениях базы: иначе
# опечатка в port_type доезжала до PostgreSQL и возвращалась пятисоткой
# вместо понятного 422 с перечнем допустимых значений.
Role = Literal["admin", "editor", "viewer"]
PortType = Literal["access", "trunk", "uplink"]
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


# ---------- Tag (вложенный, вместо площадок) ----------
class TagBase(BaseModel):
    name: str
    parent_id: Optional[int] = None
    color: Optional[str] = None


class TagCreate(TagBase):
    pass


class TagUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[int] = None
    color: Optional[str] = None


class TagOut(TagBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ---------- Topology group (отдельный от тегов параметр: одна группа
# на устройство, без вложенности — только для визуальной кластеризации
# на топологии) ----------
class TopologyGroupCreate(BaseModel):
    name: str
    color: Optional[str] = None


class TopologyGroupUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None


class TopologyGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    color: Optional[str] = None


# ---------- Device type (категория устройства) ----------
class DeviceTypeCreate(BaseModel):
    name: str
    code_prefix: str


class DeviceTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    code_prefix: str


# ---------- VLAN ----------
class VlanBase(BaseModel):
    vlan_number: int
    name: Optional[str] = None
    subnet: Optional[IPNetworkStr] = None
    gateway: Optional[IPAddressStr] = None
    dhcp_range: Optional[str] = None
    notes: Optional[str] = None


class VlanCreate(VlanBase):
    pass


class VlanOut(VlanBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ---------- Interface template (порт в шаблоне устройства) ----------
class InterfaceTemplateBase(BaseModel):
    label: str
    port_number: Optional[int] = None
    port_type: Optional[PortType] = None


class InterfaceTemplateCreate(InterfaceTemplateBase):
    pass


class InterfaceTemplateOut(InterfaceTemplateBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


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
    interfaces: List[InterfaceTemplateCreate] = []


class DeviceTemplateUpdate(BaseModel):
    name: Optional[str] = None
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


# ---------- Interface ----------
class InterfaceUpdate(BaseModel):
    label: Optional[str] = None
    port_number: Optional[int] = None
    port_type: Optional[PortType] = None
    vlan_id: Optional[int] = None
    trunk_vlan_ids: Optional[List[int]] = None
    ip: Optional[IPAddressStr] = None
    mac: Optional[MacAddressStr] = None
    notes: Optional[str] = None


class InterfaceCreate(BaseModel):
    """Ручное добавление порта сверх тех, что пришли из шаблона устройства."""
    label: str
    port_number: Optional[int] = None
    port_type: Optional[PortType] = None
    vlan_id: Optional[int] = None
    trunk_vlan_ids: Optional[List[int]] = None
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
    label: str
    port_number: Optional[int] = None
    port_type: Optional[PortType] = None
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
    location: Optional[str] = None
    role: Optional[DeviceRole] = None
    install_date: Optional[date] = None
    notes: Optional[str] = None
    topology_group_id: Optional[int] = None


class DeviceCreate(DeviceBase):
    tag_ids: List[int] = []


class DeviceUpdate(BaseModel):
    name: Optional[str] = None
    management_ip: Optional[IPAddressStr] = None
    location: Optional[str] = None
    role: Optional[DeviceRole] = None
    install_date: Optional[date] = None
    notes: Optional[str] = None
    topology_group_id: Optional[int] = None


class DeviceTagsUpdate(BaseModel):
    tag_ids: List[int]


class DevicePositionUpdate(BaseModel):
    """Позиция узла на топологии — сохраняется отдельно от общей формы
    редактирования устройства, обновляется при перетаскивании узла."""
    x: float
    y: float


class DeviceOut(DeviceBase):
    id: int
    code: str
    created_at: datetime
    updated_at: datetime
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
    pass


class LinkTemplateUpdate(BaseModel):
    name: Optional[str] = None
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
    length_m: Optional[float] = None
    speed_mbps: Optional[int] = None
    notes: Optional[str] = None
    # source и confirmed клиент не задаёт: связь, созданную руками, сервер
    # всегда помечает manual/подтверждена. Поля существуют под будущий
    # SNMP/LLDP-опрос, который будет заводить связи от своего имени и с
    # confirmed=false до проверки человеком.


class LinkUpdate(BaseModel):
    template_id: Optional[int] = None
    connector_type: Optional[str] = None
    length_m: Optional[float] = None
    speed_mbps: Optional[int] = None
    confirmed: Optional[bool] = None
    notes: Optional[str] = None


class LinkAttach(BaseModel):
    """Подключение подвешенного конца связи к порту: поставили новую сетевую
    карту — воткнули в неё тот же кабель."""
    interface_id: int


class LinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
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


# ---------- Topology (для визуализации) ----------
class TopologyNode(BaseModel):
    id: int
    code: str
    name: Optional[str] = None
    template_name: str
    device_type: str
    tag_ids: List[int] = []
    topology_group_id: Optional[int] = None
    topology_x: Optional[float] = None
    topology_y: Optional[float] = None


class TopologyEdge(BaseModel):
    link_id: int
    device_a_id: int
    device_b_id: int
    interface_a_id: int
    interface_b_id: int
    interface_a_label: str
    interface_b_label: str
    media_type: Optional[str] = None
    color: Optional[str] = None
    line_style: Optional[str] = None
    confirmed: bool


class TopologyOut(BaseModel):
    nodes: List[TopologyNode]
    edges: List[TopologyEdge]


# ---------- Search ----------
class SearchResult(BaseModel):
    device_id: int
    device_code: str
    device_name: Optional[str] = None
    interface_id: int
    interface_label: str
    ip: Optional[str] = None
    mac: Optional[str] = None
