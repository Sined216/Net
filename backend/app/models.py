from sqlalchemy import (
    Column, Integer, BigInteger, String, Text, Boolean, ForeignKey,
    CheckConstraint, UniqueConstraint, Numeric, DateTime, ARRAY, JSON,
    func,
)
from sqlalchemy.orm import relationship
from app.database import Base


class Site(Base):
    __tablename__ = "sites"
    id = Column(Integer, primary_key=True)
    name = Column(Text, nullable=False)
    address = Column(Text)
    notes = Column(Text)

    devices = relationship("Device", back_populates="site")


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    full_name = Column(Text, nullable=False)
    email = Column(Text, unique=True, nullable=False)
    password_hash = Column(Text, nullable=False)
    role = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (CheckConstraint("role IN ('admin','editor','viewer')"),)


class DeviceType(Base):
    __tablename__ = "device_types"
    id = Column(Integer, primary_key=True)
    name = Column(Text, unique=True, nullable=False)

    devices = relationship("Device", back_populates="device_type")


class Vlan(Base):
    __tablename__ = "vlans"
    id = Column(Integer, primary_key=True)
    site_id = Column(Integer, ForeignKey("sites.id", ondelete="SET NULL"))
    vlan_number = Column(Integer, nullable=False)
    name = Column(Text)
    subnet = Column(String)
    gateway = Column(String)
    dhcp_range = Column(Text)
    notes = Column(Text)

    __table_args__ = (UniqueConstraint("site_id", "vlan_number"),)


class Device(Base):
    __tablename__ = "devices"
    id = Column(Integer, primary_key=True)
    code = Column(Text, unique=True, nullable=False)
    name = Column(Text, nullable=False)
    device_type_id = Column(Integer, ForeignKey("device_types.id"), nullable=False)
    model = Column(Text)
    management_ip = Column(String)
    site_id = Column(Integer, ForeignKey("sites.id", ondelete="SET NULL"))
    location = Column(Text)
    role = Column(Text)
    install_date = Column(String)
    notes = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (CheckConstraint("role IN ('core','distribution','access') OR role IS NULL"),)

    site = relationship("Site", back_populates="devices")
    device_type = relationship("DeviceType", back_populates="devices")
    interfaces = relationship("Interface", back_populates="device", cascade="all, delete-orphan")


class Interface(Base):
    __tablename__ = "interfaces"
    id = Column(Integer, primary_key=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    label = Column(Text, nullable=False)
    port_number = Column(Integer)
    status = Column(Text, nullable=False, default="free")
    port_type = Column(Text)
    vlan_id = Column(Integer, ForeignKey("vlans.id", ondelete="SET NULL"))
    trunk_vlan_ids = Column(ARRAY(Integer))
    ip = Column(String)
    mac = Column(String)
    notes = Column(Text)

    __table_args__ = (
        UniqueConstraint("device_id", "label"),
        CheckConstraint("status IN ('free','up','down')"),
        CheckConstraint("port_type IN ('access','trunk','uplink') OR port_type IS NULL"),
    )

    device = relationship("Device", back_populates="interfaces")


class Link(Base):
    __tablename__ = "links"
    id = Column(Integer, primary_key=True)
    interface_a_id = Column(Integer, ForeignKey("interfaces.id", ondelete="CASCADE"), nullable=False, unique=True)
    interface_b_id = Column(Integer, ForeignKey("interfaces.id", ondelete="CASCADE"), nullable=False, unique=True)
    media_type = Column(Text)
    cable_category = Column(Text)
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
        CheckConstraint("interface_a_id <> interface_b_id"),
        CheckConstraint("media_type IN ('copper','fiber','wireless','dac','other') OR media_type IS NULL"),
        CheckConstraint("source IN ('manual','snmp','lldp')"),
    )

    interface_a = relationship("Interface", foreign_keys=[interface_a_id])
    interface_b = relationship("Interface", foreign_keys=[interface_b_id])


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
