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
// устройство — только для визуальной кластеризации; группы вкладываются
// друг в друга: цех — участок — линия) ----------
export interface TopologyGroupCreate {
  name: string;
  color?: string | null;
  /** Группа, внутри которой лежит эта. Пусто — рамка верхнего уровня. */
  parent_id?: number | null;
}
export type TopologyGroupUpdate = Partial<TopologyGroupCreate>;

export interface TopologyGroupOut {
  id: number;
  name: string;
  color: string | null;
  parent_id: number | null;
  /** Рамка на схеме: своё положение и размер, а не подгонка под содержимое.
   * Пусто у групп, которые ещё ни разу не двигали. */
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
}

/** Положение и размер рамки — отдельно от прочих полей группы: двигают её
 * часто, и правкой данных об оборудовании это не является. */
export interface TopologyGroupBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------- Импорт устройств из файла ----------
/** Строка из файла до переноса в спецификацию. Подсказки (`suggested_*`) —
 * найденные по названию записи справочников; интерфейс подставляет их в окно
 * устройства, но решает человек. */
export interface ImportRowOut {
  id: number;
  source_file: string;
  row_number: number;
  name: string | null;
  template_name: string | null;
  type_name: string | null;
  management_ip: string | null;
  location: string | null;
  notes: string | null;
  group_name: string | null;
  tags_text: string | null;
  /** Колонки файла, которым не нашлось места в модели. */
  extra: Record<string, string> | null;
  status: 'new' | 'moved';
  device_id: number | null;
  imported_at: string | null;
  suggested_template_id: number | null;
  suggested_group_id: number | null;
  suggested_tag_ids: number[];
  /** Уже заведённое устройство с тем же названием (или тем же адресом):
   * строка из файла, похоже, в спецификации уже есть. */
  same_name_device_id: number | null;
  same_ip_device_id: number | null;
}

export interface ImportSummary {
  file: string;
  added: number;
  skipped_empty: number;
}

// ---------- Разъёмы и модули ----------
export type ConnectorMedia = 'copper' | 'fiber' | 'other';

export interface ConnectorTypeCreate {
  name: string;
  media: ConnectorMedia;
  /** Клетка (SFP и подобные): разъём появляется вместе с модулем. */
  is_cage: boolean;
}
export type ConnectorTypeUpdate = Partial<ConnectorTypeCreate>;
export interface ConnectorTypeOut extends ConnectorTypeCreate {
  id: number;
}

export interface TransceiverModuleCreate {
  name: string;
  /** В какую клетку вставляется и что даёт наружу. */
  cage_connector_id?: number | null;
  connector_id?: number | null;
  notes?: string | null;
}
export type TransceiverModuleUpdate = Partial<TransceiverModuleCreate>;
export interface TransceiverModuleOut extends TransceiverModuleCreate {
  id: number;
}

// ---------- Device type ----------
/** Смена префикса действует только на будущие устройства: коды уже
 * заведённых напечатаны на наклейках и не переписываются. */
export interface DeviceTypeUpdate {
  name?: string;
  code_prefix?: string;
}

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
/** Режим порта — настройка конкретной железки, в модели его нет. */
export type PortMode = 'access' | 'trunk' | 'uplink';

export interface InterfaceTemplateCreate {
  /** Номер не передаётся: порты нумеруются подряд, новый встаёт в конец
   * ряда. Название — просто подпись, повторяться ей не запрещено. */
  label: string;
  /** Разъём — свойство модели техники. */
  connector_id?: number | null;
}

export type InterfaceTemplateUpdate = Partial<InterfaceTemplateCreate>;

/** Пачка портов одним запросом: по одному и параллельно они мешают друг
 * другу — номер вычисляется от текущего максимума. */
export interface PortsBulkCreate {
  count: number;
  connector_id?: number | null;
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
  /** Сколько устройств этой модели заведено на текущей площадке. */
  devices_count: number;
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
  /** Номер правки, который человек видел на экране. Пусто — проверки нет. */
  version?: number;
  mode?: PortMode | null;
  /** Модуль, вставленный в клетку. Разъём здесь не правится — он из модели. */
  module_id?: number | null;
  vlan_id?: number | null;
  trunk_vlan_ids?: number[] | null;
  ip?: string | null;
  mac?: string | null;
  notes?: string | null;
}

export interface InterfaceCreate {
  /** Номер порт получает сам — встаёт в конец ряда. */
  label: string;
  connector_id?: number | null;
  mode?: PortMode | null;
  module_id?: number | null;
  vlan_id?: number | null;
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
  /** Номер правки: клиент возвращает его при сохранении, и сервер по нему
   * видит, не успел ли кто-то другой. */
  version: number;
  device_id: number;
  port_number: number;
  label: string;
  mode: PortMode | null;
  /** Разъём порта, вставленный модуль и то, что торчит наружу на самом
   * деле: у клетки с модулем — разъём модуля. */
  connector: ConnectorTypeOut | null;
  module: TransceiverModuleOut | null;
  connector_effective: ConnectorTypeOut | null;
  /** Клетка без модуля: порт есть, а воткнуть в него нечего. */
  empty_cage: boolean;
  vlan_id: number | null;
  /** Транковые VLAN — списком номеров записей. Хранятся отдельной таблицей,
   * наружу отдаются так же, как раньше. */
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
  /** Номер правки, который человек видел на экране. Пусто — проверки нет. */
  version?: number;
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
  /** Номер правки, который человек видел на экране. Пусто — проверки нет. */
  version?: number;
}

export interface DevicePositionUpdate {
  x: number;
  y: number;
}

export interface DeviceOut {
  id: number;
  /** Номер правки: клиент возвращает его при сохранении, и сервер по нему
   * видит, не успел ли кто-то другой. */
  version: number;

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
  /** Номер правки, который человек видел на экране. Пусто — проверки нет. */
  version?: number;
  template_id?: number | null;
  connector_type?: string | null;
  length_m?: number | null;
  speed_mbps?: number | null;
  confirmed?: boolean;
  notes?: string | null;
}

export interface LinkOut {
  /** Номер правки: клиент возвращает его при сохранении, и сервер по нему
   * видит, не успел ли кто-то другой. */
  version: number;
  end_a?: LinkEndOut | null;
  end_b?: LinkEndOut | null;
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

// ---------- Площадки (фабрики) ----------
export interface SiteOut {
  id: number;
  name: string;
  notes: string | null;
}
export interface SiteCreate {
  name: string;
  notes?: string | null;
}
export interface SiteUpdate {
  name?: string;
  notes?: string | null;
}

// ---------- Журнал изменений ----------
export interface AuditChange {
  field: string;
  label: string;
  old: string | null;
  new: string | null;
}
export interface AuditEntryOut {
  id: number;
  action: 'create' | 'update' | 'delete' | string;
  entity_type: string;
  entity_label: string;
  entity_id: number | null;
  user_id: number | null;
  user_name: string | null;
  created_at: string;
  changes: AuditChange[];
}
export interface AuditPage {
  items: AuditEntryOut[];
  total: number;
}
export interface AuditQuery {
  entity_type?: string;
  entity_id?: number;
  user_id?: number;
  since?: string;
  limit?: number;
  offset?: number;
}

// ---------- Список устройств (без портов) ----------
export interface DeviceListItem {
  id: number;
  /** Номер правки: клиент возвращает его при сохранении, и сервер по нему
   * видит, не успел ли кто-то другой. */
  version: number;

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
  ports_total: number;
  ports_connected: number;
  tags: TagOut[];
}
export interface DevicePage {
  items: DeviceListItem[];
  total: number;
}
export interface DeviceQuery {
  q?: string;
  /** Отбор по отдельной колонке таблицы — по куску текста, без учёта регистра. */
  code?: string;
  name?: string;
  management_ip?: string;
  location?: string;
  tag_id?: number;
  device_type_id?: number;
  template_id?: number;
  topology_group_id?: number;
  sort?: string;
  desc?: boolean;
  limit?: number;
  offset?: number;
}
export interface LinkEndOut {
  device_id: number;
  device_code: string;
  device_name: string | null;
  interface_id: number;
  interface_label: string;
  port_number: number;
}
export interface LinkPage {
  items: LinkOut[];
  total: number;
}
export interface LinkQuery {
  device_id?: number;
  dangling?: boolean;
  limit?: number;
  offset?: number;
}
export interface FreePortOut {
  interface_id: number;
  label: string;
  port_number: number;
  device_id: number;
  device_code: string;
  device_name: string | null;
}
export interface FreePortQuery {
  q?: string;
  exclude_device_id?: number;
  limit?: number;
}
