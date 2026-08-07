import { apiFetch, setToken } from './client';
import type {
  Token, UserOut, UserCreate,
  TagOut, TagCreate, TagUpdate,
  DeviceTypeOut, DeviceTypeCreate,
  VlanOut, VlanCreate,
  DeviceTemplateOut, DeviceTemplateCreate, DeviceTemplateUpdate,
  InterfaceTemplateOut, InterfaceTemplateCreate,
  DeviceOut, DeviceCreate, DeviceUpdate, DeviceTagsUpdate, DevicePositionUpdate,
  InterfaceOut, InterfaceCreate, InterfaceUpdate,
  LinkTemplateOut, LinkTemplateCreate, LinkTemplateUpdate,
  LinkOut, LinkCreate, LinkUpdate,
  TopologyGroupOut, TopologyGroupCreate, TopologyGroupUpdate,
  SearchResult,
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
export const listDevices = () => apiFetch<DeviceOut[]>('/devices');
export const getDevice = (id: number) => apiFetch<DeviceOut>(`/devices/${id}`);
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
export const deleteTopologyGroup = (id: number) => apiFetch<void>(`/topology-groups/${id}`, { method: 'DELETE' });

// ---------- Link templates ----------
export const listLinkTemplates = () => apiFetch<LinkTemplateOut[]>('/link-templates');
export const createLinkTemplate = (body: LinkTemplateCreate) => apiFetch<LinkTemplateOut>('/link-templates', { method: 'POST', body });
export const updateLinkTemplate = (id: number, body: LinkTemplateUpdate) => apiFetch<LinkTemplateOut>(`/link-templates/${id}`, { method: 'PATCH', body });
export const deleteLinkTemplate = (id: number) => apiFetch<void>(`/link-templates/${id}`, { method: 'DELETE' });

// ---------- Links ----------
export const listLinks = () => apiFetch<LinkOut[]>('/links');
export const createLink = (body: LinkCreate) => apiFetch<LinkOut>('/links', { method: 'POST', body });
export const updateLink = (id: number, body: LinkUpdate) => apiFetch<LinkOut>(`/links/${id}`, { method: 'PATCH', body });
export const deleteLink = (id: number) => apiFetch<void>(`/links/${id}`, { method: 'DELETE' });

// ---------- Search ----------
export const search = (query: string) => apiFetch<SearchResult[]>('/search', { query: { query } });
