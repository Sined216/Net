/**
 * Типы запросов и ответов API.
 *
 * Тела запросов и ответов не описываются здесь руками, а выводятся из
 * `schema.ts` — файла, который генерируется из описания API самого бэкенда
 * (`npm run codegen`). Раньше это было ручное зеркало `schemas.py`: каждое
 * новое поле приходилось дописывать в двух местах, а расхождение ничем не
 * ловилось — только глазами и уже на работающем интерфейсе.
 *
 * Руками остаются только те типы, которых в описании нет: параметры строки
 * запроса (`?limit=50&sort=code`) — они в OpenAPI лежат не схемами, а
 * списками параметров у каждого маршрута.
 */

import type { components } from './schema';

type S = components['schemas'];

// ---------- Auth ----------
export type Token = S['Token'];
export type UserCreate = S['UserCreate'];
export type UserUpdate = S['UserUpdate'];
export type PasswordChange = S['PasswordChange'];
export type PasswordReset = S['PasswordReset'];
export type UserOut = S['UserOut'];
/** Роль вытаскивается из поля, а не переписывается: перечисление живёт в
 * `schemas.py`, и здесь оно должно совпадать с ним само. */
export type UserRole = UserOut['role'];

// ---------- Журнал изменений ----------
export type AuditChange = S['AuditChange'];
export type AuditEntryOut = S['AuditEntryOut'];
export type AuditPage = S['AuditPage'];

// ---------- Площадки ----------
export type SiteOut = S['SiteOut'];
export type SiteCreate = S['SiteCreate'];
export type SiteUpdate = S['SiteUpdate'];

// ---------- Теги ----------
export type TagCreate = S['TagCreate'];
export type TagUpdate = S['TagUpdate'];
export type TagOut = S['TagOut'];

// ---------- Группы на топологии ----------
export type TopologyGroupCreate = S['TopologyGroupCreate'];
export type TopologyGroupUpdate = S['TopologyGroupUpdate'];
export type TopologyGroupOut = S['TopologyGroupOut'];
export type TopologyGroupBox = S['TopologyGroupBox'];
/** Схема связей, собранная сервером. */
export type TopologyOut = S['TopologyOut'];
export type TopologyNode = S['TopologyNode'];
export type TopologyEdge = S['TopologyEdge'];

// ---------- Импорт устройств из файла ----------
export type ImportRowOut = S['ImportRowOut'];
export type ImportSummary = S['ImportSummary'];

// ---------- Разъёмы и модули ----------
export type ConnectorTypeCreate = S['ConnectorTypeCreate'];
export type ConnectorTypeUpdate = S['ConnectorTypeUpdate'];
export type ConnectorTypeOut = S['ConnectorTypeOut'];
export type ConnectorMedia = ConnectorTypeOut['media'];
export type TransceiverModuleCreate = S['TransceiverModuleCreate'];
export type TransceiverModuleUpdate = S['TransceiverModuleUpdate'];
export type TransceiverModuleOut = S['TransceiverModuleOut'];

// ---------- Типы устройств ----------
export type DeviceTypeCreate = S['DeviceTypeCreate'];
export type DeviceTypeUpdate = S['DeviceTypeUpdate'];
export type DeviceTypeOut = S['DeviceTypeOut'];

// ---------- VLAN ----------
export type VlanCreate = S['VlanCreate'];
export type VlanUpdate = S['VlanUpdate'];
export type VlanOut = S['VlanOut'];

// ---------- Шаблоны устройств и их порты ----------
export type InterfaceTemplateCreate = S['InterfaceTemplateCreate'];
export type InterfaceTemplateUpdate = S['InterfaceTemplateUpdate'];
export type InterfaceTemplateOut = S['InterfaceTemplateOut'];
export type PortsBulkCreate = S['PortsBulkCreate'];
export type DeviceTemplateCreate = S['DeviceTemplateCreate'];
export type DeviceTemplateUpdate = S['DeviceTemplateUpdate'];
export type DeviceTemplateOut = S['DeviceTemplateOut'];
export type TemplateImpact = S['TemplateImpact'];

// ---------- Порты устройства ----------
export type InterfaceCreate = S['InterfaceCreate'];
export type InterfaceUpdate = S['InterfaceUpdate'];
export type InterfaceOut = S['InterfaceOut'];
export type ConnectedTo = S['ConnectedTo'];
/** Режим порта — настройка конкретной железки, в модели его нет. */
export type PortMode = NonNullable<InterfaceUpdate['mode']>;

// ---------- Устройства ----------
export type DeviceCreate = S['DeviceCreate'];
export type DeviceUpdate = S['DeviceUpdate'];
export type DeviceTagsUpdate = S['DeviceTagsUpdate'];
export type DevicePositionUpdate = S['DevicePositionUpdate'];
export type DevicePositionsUpdate = S['DevicePositionsUpdate'];
export type DeviceOut = S['DeviceOut'];
export type DeviceListItem = S['DeviceListItem'];
export type DevicePage = S['DevicePage'];
export type DeviceRole = NonNullable<DeviceOut['role']>;

// ---------- Связи ----------
export type LinkTemplateCreate = S['LinkTemplateCreate'];
export type LinkTemplateUpdate = S['LinkTemplateUpdate'];
export type LinkTemplateOut = S['LinkTemplateOut'];
export type MediaType = LinkTemplateOut['media_type'];
export type LineStyle = LinkTemplateOut['line_style'];
export type LinkCreate = S['LinkCreate'];
export type LinkUpdate = S['LinkUpdate'];
export type LinkOut = S['LinkOut'];
export type LinkEndOut = S['LinkEndOut'];
export type LinkPage = S['LinkPage'];

// ---------- Поиск и структура базы ----------
export type SearchResult = S['SearchResult'];
export type SchemaColumn = S['SchemaColumn'];
export type SchemaTable = S['SchemaTable'];
export type DatabaseSchema = S['DatabaseSchema'];
export type FreePortOut = S['FreePortOut'];

// ---------- Параметры строки запроса ----------
// В OpenAPI они описаны не схемами, а списком параметров у каждого
// маршрута, поэтому остаются здесь руками. Полей немного, и меняются они
// реже, чем тела ответов.
export interface AuditQuery {
  entity_type?: string;
  entity_id?: number;
  user_id?: number;
  since?: string;
  limit?: number;
  offset?: number;
}

export interface DeviceQuery {
  q?: string;
  /** Отбор по отдельной колонке таблицы — по куску текста, без учёта регистра. */
  code?: string;
  name?: string;
  management_ip?: string;
  mac?: string;
  tag_id?: number;
  device_type_id?: number;
  template_id?: number;
  topology_group_id?: number;
  sort?: string;
  desc?: boolean;
  limit?: number;
  offset?: number;
}

export interface LinkQuery {
  device_id?: number;
  dangling?: boolean;
  limit?: number;
  offset?: number;
}

export interface FreePortQuery {
  q?: string;
  exclude_device_id?: number;
  device_id?: number;
  limit?: number;
}

// ---------- SNMP (отдельная страница, ничем не связана с остальным) ----------
export type SnmpProbeRequest = S['SnmpProbeRequest'];
export type SnmpProbeResult = S['SnmpProbeResult'];
export type SnmpSystemInfo = S['SnmpSystemInfo'];
export type SnmpInterfaceInfo = S['SnmpInterfaceInfo'];
export type SnmpIpAddress = S['SnmpIpAddress'];
export type SnmpArpEntry = S['SnmpArpEntry'];
export type SnmpMacEntry = S['SnmpMacEntry'];
export type SnmpTraceStep = S['SnmpTraceStep'];
export type SnmpVersion = SnmpProbeRequest['version'];
export type SnmpSecurityLevel = NonNullable<SnmpProbeRequest['security_level']>;
export type SnmpAuthProtocol = NonNullable<SnmpProbeRequest['auth_protocol']>;
export type SnmpPrivProtocol = NonNullable<SnmpProbeRequest['priv_protocol']>;
export type SnmpWalkRequest = S['SnmpWalkRequest'];
export type SnmpWalkResult = S['SnmpWalkResult'];
export type SnmpRawOid = S['SnmpRawOid'];
