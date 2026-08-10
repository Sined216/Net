import { apiFetch, setToken } from './client';
import type {
  Token, UserOut, UserCreate, UserUpdate, PasswordChange, PasswordReset,
  TagOut, TagCreate, TagUpdate,
  DeviceTypeOut, DeviceTypeCreate, DeviceTypeUpdate,
  ConnectorTypeOut, ConnectorTypeCreate, ConnectorTypeUpdate,
  TransceiverModuleOut, TransceiverModuleCreate, TransceiverModuleUpdate,
  VlanOut, VlanCreate,
  DeviceTemplateOut, DeviceTemplateCreate, DeviceTemplateUpdate,
  InterfaceTemplateOut, InterfaceTemplateCreate, InterfaceTemplateUpdate, PortsBulkCreate,
  DeviceOut, DeviceCreate, DeviceUpdate, DeviceTagsUpdate, DevicePositionUpdate,
  InterfaceOut, InterfaceCreate, InterfaceUpdate,
  LinkTemplateOut, LinkTemplateCreate, LinkTemplateUpdate,
  LinkOut, LinkCreate, LinkUpdate, TemplateImpact,
  TopologyGroupOut, TopologyGroupCreate, TopologyGroupUpdate, TopologyGroupBox,
  SearchResult, DatabaseSchema, ImportRowOut, ImportSummary,
  SiteOut, SiteCreate, SiteUpdate, AuditPage, AuditQuery,
  DevicePage, DeviceQuery, LinkPage, LinkQuery, FreePortOut, FreePortQuery,
} from './types';

// ---------- Auth ----------
export async function login(username: string, password: string): Promise<Token> {
  const form = new URLSearchParams();
  form.set('username', username);
  form.set('password', password);
  const token = await apiFetch<Token>('/auth/login', { method: 'POST', form, auth: false });
  setToken(token.access_token);
  return token;
}
export const me = () => apiFetch<UserOut>('/auth/me');
export const listUsers = () => apiFetch<UserOut[]>('/auth/users');
export const createUser = (body: UserCreate) => apiFetch<UserOut>('/auth/users', { method: 'POST', body });
export const updateUser = (id: number, body: UserUpdate) => apiFetch<UserOut>(`/auth/users/${id}`, { method: 'PATCH', body });
export const deactivateUser = (id: number) => apiFetch<UserOut>(`/auth/users/${id}`, { method: 'DELETE' });
export const resetUserPassword = (id: number, body: PasswordReset) =>
  apiFetch<UserOut>(`/auth/users/${id}/password`, { method: 'POST', body });
export const changeOwnPassword = (body: PasswordChange) =>
  apiFetch<UserOut>('/auth/me/password', { method: 'POST', body });

// ---------- Tags ----------
export const listTags = () => apiFetch<TagOut[]>('/tags');
export const createTag = (body: TagCreate) => apiFetch<TagOut>('/tags', { method: 'POST', body });
export const updateTag = (id: number, body: TagUpdate) => apiFetch<TagOut>(`/tags/${id}`, { method: 'PATCH', body });
export const deleteTag = (id: number) => apiFetch<void>(`/tags/${id}`, { method: 'DELETE' });

// ---------- Device types ----------
export const listDeviceTypes = () => apiFetch<DeviceTypeOut[]>('/device-types');
export const createDeviceType = (body: DeviceTypeCreate) => apiFetch<DeviceTypeOut>('/device-types', { method: 'POST', body });
export const deleteDeviceType = (id: number) => apiFetch<void>(`/device-types/${id}`, { method: 'DELETE' });

// ---------- VLANs ----------
export const listConnectorTypes = () => apiFetch<ConnectorTypeOut[]>('/connector-types');
export const createConnectorType = (body: ConnectorTypeCreate) => apiFetch<ConnectorTypeOut>('/connector-types', { method: 'POST', body });
export const updateConnectorType = (id: number, body: ConnectorTypeUpdate) => apiFetch<ConnectorTypeOut>(`/connector-types/${id}`, { method: 'PATCH', body });
export const deleteConnectorType = (id: number) => apiFetch<void>(`/connector-types/${id}`, { method: 'DELETE' });

export const listModules = () => apiFetch<TransceiverModuleOut[]>('/modules');
export const createModule = (body: TransceiverModuleCreate) => apiFetch<TransceiverModuleOut>('/modules', { method: 'POST', body });
export const updateModule = (id: number, body: TransceiverModuleUpdate) => apiFetch<TransceiverModuleOut>(`/modules/${id}`, { method: 'PATCH', body });
export const deleteModule = (id: number) => apiFetch<void>(`/modules/${id}`, { method: 'DELETE' });

export const updateDeviceType = (id: number, body: DeviceTypeUpdate) => apiFetch<DeviceTypeOut>(`/device-types/${id}`, { method: 'PATCH', body });

export const updateTemplateInterface = (templateId: number, ifaceId: number, body: InterfaceTemplateUpdate) =>
  apiFetch<InterfaceTemplateOut>(`/device-templates/${templateId}/interfaces/${ifaceId}`, { method: 'PATCH', body });
export const addTemplateInterfacesBulk = (templateId: number, body: PortsBulkCreate) =>
  apiFetch<InterfaceTemplateOut[]>(`/device-templates/${templateId}/interfaces/bulk`, { method: 'POST', body });
export const addInterfacesBulk = (deviceId: number, body: PortsBulkCreate) =>
  apiFetch<InterfaceOut[]>(`/devices/${deviceId}/interfaces/bulk`, { method: 'POST', body });
export const copyDeviceTemplate = (id: number) => apiFetch<DeviceTemplateOut>(`/device-templates/${id}/copy`, { method: 'POST' });

// ---------- Импорт ----------
export const uploadImportFile = (file: File) => {
  const upload = new FormData();
  upload.append('file', file);
  return apiFetch<ImportSummary>('/import/devices', { method: 'POST', upload });
};
export const listImportRows = () => apiFetch<ImportRowOut[]>('/import/rows');
export const moveImportRow = (rowId: number, body: DeviceCreate) =>
  apiFetch<DeviceOut>(`/import/rows/${rowId}/move`, { method: 'POST', body });
export const deleteImportRow = (rowId: number) => apiFetch<void>(`/import/rows/${rowId}`, { method: 'DELETE' });
export const clearImportRows = (status?: 'new' | 'moved') =>
  apiFetch<void>('/import/rows', { method: 'DELETE', query: { status } });

export const listVlans = () => apiFetch<VlanOut[]>('/vlans');
export const createVlan = (body: VlanCreate) => apiFetch<VlanOut>('/vlans', { method: 'POST', body });
export const deleteVlan = (id: number) => apiFetch<void>(`/vlans/${id}`, { method: 'DELETE' });

// ---------- Device templates ----------
export const listDeviceTemplates = () => apiFetch<DeviceTemplateOut[]>('/device-templates');
export const createDeviceTemplate = (body: DeviceTemplateCreate) => apiFetch<DeviceTemplateOut>('/device-templates', { method: 'POST', body });
export const updateDeviceTemplate = (id: number, body: DeviceTemplateUpdate) => apiFetch<DeviceTemplateOut>(`/device-templates/${id}`, { method: 'PATCH', body });
export const deleteDeviceTemplate = (id: number) => apiFetch<void>(`/device-templates/${id}`, { method: 'DELETE' });
export const addTemplateInterface = (templateId: number, body: InterfaceTemplateCreate) =>
  apiFetch<InterfaceTemplateOut>(`/device-templates/${templateId}/interfaces`, { method: 'POST', body });
export const deleteTemplateInterface = (templateId: number, ifaceId: number) =>
  apiFetch<void>(`/device-templates/${templateId}/interfaces/${ifaceId}`, { method: 'DELETE' });

// ---------- Devices ----------
export const listDevices = (query: DeviceQuery = {}) =>
  apiFetch<DevicePage>('/devices', { query: query as Record<string, string | number | undefined> });
/** Устройства со всеми портами — только для схемы связей: она рисует
 * площадку целиком и страницами не показывается. */
export const listTopologyDevices = () => apiFetch<DeviceOut[]>('/topology/devices');
export const listFreePorts = (query: FreePortQuery = {}) =>
  apiFetch<FreePortOut[]>('/interfaces/free', { query: query as Record<string, string | number | undefined> });
export const getDevice = (id: number) => apiFetch<DeviceOut>(`/devices/${id}`);
export const listInterfaces = (deviceId: number) =>
  apiFetch<InterfaceOut[]>(`/devices/${deviceId}/interfaces`);
export const createDevice = (body: DeviceCreate) => apiFetch<DeviceOut>('/devices', { method: 'POST', body });
export const updateDevice = (id: number, body: DeviceUpdate) => apiFetch<DeviceOut>(`/devices/${id}`, { method: 'PATCH', body });
export const deleteDevice = (id: number) => apiFetch<void>(`/devices/${id}`, { method: 'DELETE' });
export const setDeviceTags = (id: number, body: DeviceTagsUpdate) => apiFetch<DeviceOut>(`/devices/${id}/tags`, { method: 'PUT', body });
export const addInterface = (deviceId: number, body: InterfaceCreate) =>
  apiFetch<InterfaceOut>(`/devices/${deviceId}/interfaces`, { method: 'POST', body });
export const updateInterface = (id: number, body: InterfaceUpdate) => apiFetch<InterfaceOut>(`/interfaces/${id}`, { method: 'PATCH', body });
export const deleteInterface = (id: number) => apiFetch<void>(`/interfaces/${id}`, { method: 'DELETE' });
export const updateDevicePosition = (id: number, body: DevicePositionUpdate) =>
  apiFetch<DeviceOut>(`/devices/${id}/position`, { method: 'PATCH', body });

// ---------- Topology groups ----------
export const listTopologyGroups = () => apiFetch<TopologyGroupOut[]>('/topology-groups');
export const createTopologyGroup = (body: TopologyGroupCreate) => apiFetch<TopologyGroupOut>('/topology-groups', { method: 'POST', body });
export const updateTopologyGroup = (id: number, body: TopologyGroupUpdate) => apiFetch<TopologyGroupOut>(`/topology-groups/${id}`, { method: 'PATCH', body });
export const setTopologyGroupBox = (id: number, body: TopologyGroupBox) => apiFetch<TopologyGroupOut>(`/topology-groups/${id}/box`, { method: 'PATCH', body });
export const deleteTopologyGroup = (id: number) => apiFetch<void>(`/topology-groups/${id}`, { method: 'DELETE' });

// ---------- Link templates ----------
export const listLinkTemplates = () => apiFetch<LinkTemplateOut[]>('/link-templates');
export const createLinkTemplate = (body: LinkTemplateCreate) => apiFetch<LinkTemplateOut>('/link-templates', { method: 'POST', body });
export const updateLinkTemplate = (id: number, body: LinkTemplateUpdate) => apiFetch<LinkTemplateOut>(`/link-templates/${id}`, { method: 'PATCH', body });
export const deleteLinkTemplate = (id: number) => apiFetch<void>(`/link-templates/${id}`, { method: 'DELETE' });

// ---------- Links ----------
export const listLinks = (query: LinkQuery = {}) =>
  apiFetch<LinkPage>('/links', { query: query as Record<string, string | number | undefined> });
export const createLink = (body: LinkCreate) => apiFetch<LinkOut>('/links', { method: 'POST', body });
export const updateLink = (id: number, body: LinkUpdate) => apiFetch<LinkOut>(`/links/${id}`, { method: 'PATCH', body });
export const deleteLink = (id: number) => apiFetch<void>(`/links/${id}`, { method: 'DELETE' });
export const attachLinkEnd = (id: number, interfaceId: number) =>
  apiFetch<LinkOut>(`/links/${id}/attach`, { method: 'POST', body: { interface_id: interfaceId } });
export const templateImpact = (id: number) => apiFetch<TemplateImpact>(`/device-templates/${id}/impact`);

// ---------- Search ----------
export const search = (query: string) => apiFetch<SearchResult[]>('/search', { query: { query } });

// ---------- Структура БД ----------
export const getDatabaseSchema = () => apiFetch<DatabaseSchema>('/schema');

// ---------- Площадки ----------
export const listSites = () => apiFetch<SiteOut[]>('/sites');
export const createSite = (body: SiteCreate) => apiFetch<SiteOut>('/sites', { method: 'POST', body });
export const updateSite = (id: number, body: SiteUpdate) => apiFetch<SiteOut>(`/sites/${id}`, { method: 'PATCH', body });
export const deleteSite = (id: number) => apiFetch<void>(`/sites/${id}`, { method: 'DELETE' });
export const listSiteAccess = (id: number) => apiFetch<number[]>(`/sites/${id}/access`);
export const setSiteAccess = (id: number, userIds: number[]) =>
  apiFetch<number[]>(`/sites/${id}/access`, { method: 'PUT', body: { user_ids: userIds } });

// ---------- Журнал изменений ----------
export const listAudit = (query: AuditQuery) =>
  apiFetch<AuditPage>('/audit', { query: query as Record<string, string | number | undefined> });
