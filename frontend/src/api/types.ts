/**
 * Типы запросов/ответов API — зеркалят backend/app/schemas.py.
 * Если меняется схема на бэкенде, эти типы надо обновить вручную (типы
 * не генерируются автоматически из OpenAPI — для проекта такого размера
 * это осознанный компромисс, не стоит подключать генератор).
 */

// ---------- Auth ----------
export interface Token {
  access_token: string;
  token_type: string;
}

export type UserRole = 'admin' | 'editor' | 'viewer';

export interface UserCreate {
  full_name: string;
  username: string;
  password: string;
  role: UserRole;
}

export interface UserUpdate {
  full_name?: string;
  role?: UserRole;
  is_active?: boolean;
}

export interface PasswordChange {
  current_password: string;
  new_password: string;
}

export interface PasswordReset {
  new_password: string;
}

export interface UserOut {
  id: number;
  full_name: string;
  username: string;
  role: UserRole;
  is_active: boolean;
  /** Пароль назначен не владельцем — интерфейс требует сменить его при входе. */
  must_change_password: boolean;
  created_at: string;
}

// ---------- Tag ----------
export interface TagCreate {
  name: string;
  parent_id: number | null;
  color: string | null;
}
export type TagUpdate = Partial<TagCreate>;

export interface TagOut {
  id: number;
  name: string;
  parent_id: number | null;
  color: string | null;
}

// ---------- Topology group (отдельный от тегов параметр: одна группа на
// устройство, без вложенности — только для визуальной кластеризации) ----------
export interface TopologyGroupCreate {
  name: string;
  color?: string | null;
}
export type TopologyGroupUpdate = Partial<TopologyGroupCreate>;

export interface TopologyGroupOut {
  id: number;
  name: string;
  color: string | null;
}

// ---------- Device type ----------
export interface DeviceTypeCreate {
  name: string;
  code_prefix: string;
}

export interface DeviceTypeOut {
  id: number;
  name: string;
  code_prefix: string;
}

// ---------- VLAN ----------
export interface VlanCreate {
  vlan_number: number;
  name?: string | null;
  subnet?: string | null;
  gateway?: string | null;
  dhcp_range?: string | null;
  notes?: string | null;
}

export interface VlanOut extends VlanCreate {
  id: number;
}

// ---------- Interface template (порт шаблона) ----------
export type PortType = 'access' | 'trunk' | 'uplink';

export interface InterfaceTemplateCreate {
  /** Номер не передаётся: порты нумеруются подряд, новый встаёт в конец
   * ряда. Название — просто подпись, повторяться ей не запрещено. */
  label: string;
  port_type?: PortType | null;
}

export interface InterfaceTemplateOut extends InterfaceTemplateCreate {
  id: number;
  /** Место порта в ряду гнёзд, 1..N без пропусков. Назначает сервер. */
  port_number: number;
}

// ---------- Device template ----------
export interface DeviceTemplateCreate {
  name: string;
  device_type_id: number;
  manufacturer?: string | null;
  notes?: string | null;
  /** Цвет узла на схеме — одна настройка на модель техники. */
  color?: string | null;
  /** Разрешить менять состав портов у конкретного устройства (ПК со съёмной картой). */
  ports_editable_on_device?: boolean;
  interfaces: InterfaceTemplateCreate[];
}

export interface DeviceTemplateUpdate {
  name?: string;
  device_type_id?: number;
  manufacturer?: string | null;
  notes?: string | null;
  color?: string | null;
  ports_editable_on_device?: boolean;
}

export interface DeviceTemplateOut {
  id: number;
  name: string;
  device_type_id: number;
  manufacturer: string | null;
  notes: string | null;
  color: string | null;
  ports_editable_on_device: boolean;
  interfaces: InterfaceTemplateOut[];
}

/** Что заденет правка портов модели. */
export interface TemplateImpact {
  devices: number;
  connected_ports: number;
}

// ---------- Interface ----------
/** Правка порта у устройства. Названия и номера здесь нет: они описывают
 * модель техники и правятся в шаблоне. */
export interface InterfaceUpdate {
  port_type?: PortType | null;
  vlan_id?: number | null;
  trunk_vlan_ids?: number[] | null;
  ip?: string | null;
  mac?: string | null;
  notes?: string | null;
}

export interface InterfaceCreate {
  /** Номер порт получает сам — встаёт в конец ряда. */
  label: string;
  port_type?: PortType | null;
  vlan_id?: number | null;
  trunk_vlan_ids?: number[] | null;
  ip?: string | null;
  mac?: string | null;
  notes?: string | null;
}

export interface ConnectedTo {
  link_id: number;
  device_id: number;
  device_code: string;
  device_name: string | null;
  interface_id: number;
  interface_label: string;
}

export interface InterfaceOut {
  id: number;
  device_id: number;
  port_number: number;
  label: string;
  port_type: PortType | null;
  vlan_id: number | null;
  trunk_vlan_ids: number[] | null;
  ip: string | null;
  mac: string | null;
  notes: string | null;
  /** Связь, в которой участвует порт. Есть даже при подвешенном втором
   * конце, поэтому порт свободен ровно когда link_id пуст. */
  link_id: number | null;
  connected_to: ConnectedTo | null;
}

// ---------- Device ----------
export type DeviceRole = 'core' | 'distribution' | 'access';

export interface DeviceCreate {
  template_id: number;
  name?: string | null;
  management_ip?: string | null;
  location?: string | null;
  role?: DeviceRole | null;
  install_date?: string | null;
  notes?: string | null;
  topology_group_id?: number | null;
  tag_ids: number[];
}

export interface DeviceUpdate {
  name?: string | null;
  management_ip?: string | null;
  location?: string | null;
  role?: DeviceRole | null;
  install_date?: string | null;
  notes?: string | null;
  topology_group_id?: number | null;
}

export interface DeviceTagsUpdate {
  tag_ids: number[];
}

export interface DevicePositionUpdate {
  x: number;
  y: number;
}

export interface DeviceOut {
  id: number;
  template_id: number;
  code: string;
  name: string | null;
  management_ip: string | null;
  location: string | null;
  role: DeviceRole | null;
  install_date: string | null;
  notes: string | null;
  topology_group_id: number | null;
  topology_x: number | null;
  topology_y: number | null;
  created_at: string;
  updated_at: string;
  interfaces: InterfaceOut[];
  tags: TagOut[];
}

// ---------- Link template ----------
export type MediaType = 'copper' | 'fiber' | 'wireless' | 'dac' | 'other';
export type LineStyle = 'solid' | 'dashed' | 'dotted';

export interface LinkTemplateCreate {
  name: string;
  media_type: MediaType;
  cable_category?: string | null;
  color: string;
  line_style: LineStyle;
}
export type LinkTemplateUpdate = Partial<LinkTemplateCreate>;

export interface LinkTemplateOut extends LinkTemplateCreate {
  id: number;
}

// ---------- Link ----------
export interface LinkCreate {
  interface_a_id: number;
  interface_b_id: number;
  template_id?: number | null;
  connector_type?: string | null;
  length_m?: number | null;
  speed_mbps?: number | null;
  source?: string;
  confirmed?: boolean;
  notes?: string | null;
}

export interface LinkUpdate {
  template_id?: number | null;
  connector_type?: string | null;
  length_m?: number | null;
  speed_mbps?: number | null;
  confirmed?: boolean;
  notes?: string | null;
}

export interface LinkOut {
  id: number;
  /** Пусто — конец «подвешен»: порт удалили, кабель остался. */
  interface_a_id: number | null;
  interface_b_id: number | null;
  template_id: number | null;
  connector_type: string | null;
  length_m: number | null;
  speed_mbps: number | null;
  source: string;
  confirmed: boolean;
  notes: string | null;
  updated_at: string;
}

// ---------- Search ----------
export interface SearchResult {
  device_id: number;
  device_code: string;
  device_name: string | null;
  interface_id: number;
  interface_label: string;
  ip: string | null;
  mac: string | null;
}

// ---------- Структура БД ----------
export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  primary_key: boolean;
  unique: boolean;
  /** «таблица.колонка», куда указывает внешний ключ. */
  references: string | null;
}

export interface SchemaTable {
  name: string;
  note: string | null;
  columns: SchemaColumn[];
  row_count: number;
}

export interface DatabaseSchema {
  tables: SchemaTable[];
}
