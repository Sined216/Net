from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict


# ---------- Auth ----------
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserCreate(BaseModel):
    full_name: str
    username: str
    password: str
    role: str = "viewer"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    full_name: str
    username: str
    role: str
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
    subnet: Optional[str] = None
    gateway: Optional[str] = None
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
    port_type: Optional[str] = None


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


class DeviceTemplateCreate(DeviceTemplateBase):
    interfaces: List[InterfaceTemplateCreate] = []


class DeviceTemplateUpdate(BaseModel):
    name: Optional[str] = None
    device_type_id: Optional[int] = None
    manufacturer: Optional[str] = None
    notes: Optional[str] = None


class DeviceTemplateOut(DeviceTemplateBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    interfaces: List[InterfaceTemplateOut] = []


# ---------- Interface ----------
class InterfaceUpdate(BaseModel):
    label: Optional[str] = None
    port_number: Optional[int] = None
    port_type: Optional[str] = None
    vlan_id: Optional[int] = None
    trunk_vlan_ids: Optional[List[int]] = None
    ip: Optional[str] = None
    mac: Optional[str] = None
    notes: Optional[str] = None


class InterfaceCreate(BaseModel):
    """Ручное добавление порта сверх тех, что пришли из шаблона устройства."""
    label: str
    port_number: Optional[int] = None
    port_type: Optional[str] = None
    vlan_id: Optional[int] = None
    trunk_vlan_ids: Optional[List[int]] = None
    ip: Optional[str] = None
    mac: Optional[str] = None
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
    port_type: Optional[str] = None
    vlan_id: Optional[int] = None
    trunk_vlan_ids: Optional[List[int]] = None
    ip: Optional[str] = None
    mac: Optional[str] = None
    notes: Optional[str] = None
    connected_to: Optional[ConnectedTo] = None


# ---------- Device (устройство в спецификации оборудования) ----------
class DeviceBase(BaseModel):
    template_id: int
    name: Optional[str] = None
    management_ip: Optional[str] = None
    location: Optional[str] = None
    role: Optional[str] = None
    install_date: Optional[str] = None
    notes: Optional[str] = None
    topology_group_id: Optional[int] = None


class DeviceCreate(DeviceBase):
    tag_ids: List[int] = []


class DeviceUpdate(BaseModel):
    name: Optional[str] = None
    management_ip: Optional[str] = None
    location: Optional[str] = None
    role: Optional[str] = None
    install_date: Optional[str] = None
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
    media_type: str
    cable_category: Optional[str] = None
    color: str = "#888888"
    line_style: str = "solid"


class LinkTemplateCreate(LinkTemplateBase):
    pass


class LinkTemplateUpdate(BaseModel):
    name: Optional[str] = None
    media_type: Optional[str] = None
    cable_category: Optional[str] = None
    color: Optional[str] = None
    line_style: Optional[str] = None


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
    source: str = "manual"
    confirmed: bool = True
    notes: Optional[str] = None


class LinkUpdate(BaseModel):
    template_id: Optional[int] = None
    connector_type: Optional[str] = None
    length_m: Optional[float] = None
    speed_mbps: Optional[int] = None
    confirmed: Optional[bool] = None
    notes: Optional[str] = None


class LinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    interface_a_id: int
    interface_b_id: int
    template_id: Optional[int] = None
    connector_type: Optional[str] = None
    length_m: Optional[float] = None
    speed_mbps: Optional[int] = None
    source: str
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
