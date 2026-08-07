from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, EmailStr


# ---------- Auth ----------
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserCreate(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    role: str = "viewer"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    full_name: str
    email: EmailStr
    role: str
    created_at: datetime


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


# ---------- Site ----------
class SiteBase(BaseModel):
    name: str
    address: Optional[str] = None
    notes: Optional[str] = None


class SiteCreate(SiteBase):
    pass


class SiteOut(SiteBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ---------- Device type ----------
class DeviceTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


# ---------- VLAN ----------
class VlanBase(BaseModel):
    site_id: Optional[int] = None
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


# ---------- Interface ----------
class InterfaceBase(BaseModel):
    label: str
    port_number: Optional[int] = None
    status: str = "free"
    port_type: Optional[str] = None
    vlan_id: Optional[int] = None
    trunk_vlan_ids: Optional[List[int]] = None
    ip: Optional[str] = None
    mac: Optional[str] = None
    notes: Optional[str] = None


class InterfaceCreate(InterfaceBase):
    pass


class InterfaceUpdate(BaseModel):
    label: Optional[str] = None
    port_number: Optional[int] = None
    status: Optional[str] = None
    port_type: Optional[str] = None
    vlan_id: Optional[int] = None
    trunk_vlan_ids: Optional[List[int]] = None
    ip: Optional[str] = None
    mac: Optional[str] = None
    notes: Optional[str] = None


class InterfaceOut(InterfaceBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    device_id: int


# ---------- Device ----------
class DeviceBase(BaseModel):
    code: str
    name: str
    device_type_id: int
    model: Optional[str] = None
    management_ip: Optional[str] = None
    site_id: Optional[int] = None
    location: Optional[str] = None
    role: Optional[str] = None
    install_date: Optional[str] = None
    notes: Optional[str] = None


class DeviceCreate(DeviceBase):
    interfaces: Optional[List[InterfaceCreate]] = None


class DeviceUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    device_type_id: Optional[int] = None
    model: Optional[str] = None
    management_ip: Optional[str] = None
    site_id: Optional[int] = None
    location: Optional[str] = None
    role: Optional[str] = None
    install_date: Optional[str] = None
    notes: Optional[str] = None


class DeviceOut(DeviceBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    updated_at: datetime
    interfaces: List[InterfaceOut] = []


# ---------- Link ----------
class LinkCreate(BaseModel):
    interface_a_id: int
    interface_b_id: int
    media_type: Optional[str] = None
    cable_category: Optional[str] = None
    connector_type: Optional[str] = None
    length_m: Optional[float] = None
    speed_mbps: Optional[int] = None
    source: str = "manual"
    confirmed: bool = True
    notes: Optional[str] = None


class LinkUpdate(BaseModel):
    media_type: Optional[str] = None
    cable_category: Optional[str] = None
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
    media_type: Optional[str] = None
    cable_category: Optional[str] = None
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
    name: str
    device_type: str
    site_id: Optional[int] = None


class TopologyEdge(BaseModel):
    link_id: int
    device_a_id: int
    device_b_id: int
    interface_a_label: str
    interface_b_label: str
    media_type: Optional[str] = None
    confirmed: bool


class TopologyOut(BaseModel):
    nodes: List[TopologyNode]
    edges: List[TopologyEdge]


# ---------- Search ----------
class SearchResult(BaseModel):
    device_id: int
    device_code: str
    device_name: str
    interface_id: int
    interface_label: str
    ip: Optional[str] = None
    mac: Optional[str] = None
