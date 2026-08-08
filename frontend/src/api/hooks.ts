import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './endpoints';
import type {
  TagCreate, TagUpdate,
  DeviceTypeCreate,
  VlanCreate,
  DeviceTemplateCreate, DeviceTemplateUpdate, InterfaceTemplateCreate,
  DeviceCreate, DeviceUpdate, DeviceTagsUpdate, DevicePositionUpdate,
  InterfaceCreate, InterfaceUpdate,
  LinkTemplateCreate, LinkTemplateUpdate,
  LinkCreate, LinkUpdate,
  TopologyGroupCreate, TopologyGroupUpdate,
  UserCreate, UserUpdate, PasswordReset,
} from './types';

// ---------- Queries ----------
export const useTags = () => useQuery({ queryKey: ['tags'], queryFn: api.listTags });
export const useDeviceTypes = () => useQuery({ queryKey: ['deviceTypes'], queryFn: api.listDeviceTypes });
export const useVlans = () => useQuery({ queryKey: ['vlans'], queryFn: api.listVlans });
export const useDeviceTemplates = () => useQuery({ queryKey: ['deviceTemplates'], queryFn: api.listDeviceTemplates });
export const useDevices = () => useQuery({ queryKey: ['devices'], queryFn: api.listDevices });
export const useLinks = () => useQuery({ queryKey: ['links'], queryFn: api.listLinks });
export const useLinkTemplates = () => useQuery({ queryKey: ['linkTemplates'], queryFn: api.listLinkTemplates });
export const useTopologyGroups = () => useQuery({ queryKey: ['topologyGroups'], queryFn: api.listTopologyGroups });
export const useUsers = () => useQuery({ queryKey: ['users'], queryFn: api.listUsers });

/** Ключи, которые нужно освежить после почти любой мутации — статус портов
 * (connected_to) и списки живут в devices/links одновременно. */
const CORE_KEYS = ['devices', 'links'] as const;

function invalidateAll(qc: ReturnType<typeof useQueryClient>, keys: readonly string[]) {
  return Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

// ---------- Tags ----------
export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TagCreate) => api.createTag(body),
    onSuccess: () => invalidateAll(qc, ['tags', 'devices']),
  });
}
export function useUpdateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: TagUpdate }) => api.updateTag(id, body),
    onSuccess: () => invalidateAll(qc, ['tags', 'devices']),
  });
}
export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteTag(id),
    onSuccess: () => invalidateAll(qc, ['tags', 'devices']),
  });
}

// ---------- Device types ----------
export function useCreateDeviceType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DeviceTypeCreate) => api.createDeviceType(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deviceTypes'] }),
  });
}
export function useDeleteDeviceType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteDeviceType(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deviceTypes'] }),
  });
}

// ---------- VLANs ----------
export function useCreateVlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: VlanCreate) => api.createVlan(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vlans'] }),
  });
}
export function useDeleteVlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteVlan(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vlans'] }),
  });
}

// ---------- Device templates ----------
export function useCreateDeviceTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DeviceTemplateCreate) => api.createDeviceTemplate(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deviceTemplates'] }),
  });
}
export function useUpdateDeviceTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: DeviceTemplateUpdate }) => api.updateDeviceTemplate(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deviceTemplates'] }),
  });
}
export function useDeleteDeviceTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteDeviceTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deviceTemplates'] }),
  });
}
export function useAddTemplateInterface() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, body }: { templateId: number; body: InterfaceTemplateCreate }) =>
      api.addTemplateInterface(templateId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deviceTemplates'] }),
  });
}
export function useDeleteTemplateInterface() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, ifaceId }: { templateId: number; ifaceId: number }) =>
      api.deleteTemplateInterface(templateId, ifaceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deviceTemplates'] }),
  });
}

// ---------- Devices ----------
export function useCreateDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DeviceCreate) => api.createDevice(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
  });
}
export function useUpdateDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: DeviceUpdate }) => api.updateDevice(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
  });
}
export function useDeleteDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteDevice(id),
    onSuccess: () => invalidateAll(qc, CORE_KEYS),
  });
}
export function useSetDeviceTags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: DeviceTagsUpdate }) => api.setDeviceTags(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
  });
}
export function useAddInterface() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ deviceId, body }: { deviceId: number; body: InterfaceCreate }) => api.addInterface(deviceId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
  });
}
export function useUpdateInterface() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: InterfaceUpdate }) => api.updateInterface(id, body),
    onSuccess: () => invalidateAll(qc, CORE_KEYS),
  });
}
export function useDeleteInterface() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteInterface(id),
    onSuccess: () => invalidateAll(qc, CORE_KEYS),
  });
}
export function useUpdateDevicePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: DevicePositionUpdate }) => api.updateDevicePosition(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
  });
}

// ---------- Topology groups ----------
export function useCreateTopologyGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TopologyGroupCreate) => api.createTopologyGroup(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['topologyGroups'] }),
  });
}
export function useUpdateTopologyGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: TopologyGroupUpdate }) => api.updateTopologyGroup(id, body),
    onSuccess: () => invalidateAll(qc, ['topologyGroups', 'devices']),
  });
}
export function useDeleteTopologyGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteTopologyGroup(id),
    onSuccess: () => invalidateAll(qc, ['topologyGroups', 'devices']),
  });
}

// ---------- Link templates ----------
export function useCreateLinkTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LinkTemplateCreate) => api.createLinkTemplate(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['linkTemplates'] }),
  });
}
export function useUpdateLinkTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: LinkTemplateUpdate }) => api.updateLinkTemplate(id, body),
    onSuccess: () => invalidateAll(qc, ['linkTemplates', 'links']),
  });
}
export function useDeleteLinkTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteLinkTemplate(id),
    onSuccess: () => invalidateAll(qc, ['linkTemplates', 'links']),
  });
}

// ---------- Links ----------
export function useCreateLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LinkCreate) => api.createLink(body),
    onSuccess: () => invalidateAll(qc, CORE_KEYS),
  });
}
export function useUpdateLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: LinkUpdate }) => api.updateLink(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['links'] }),
  });
}
export function useDeleteLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteLink(id),
    onSuccess: () => invalidateAll(qc, CORE_KEYS),
  });
}

// ---------- Users ----------
export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UserCreate) => api.createUser(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}
export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: UserUpdate }) => api.updateUser(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}
export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deactivateUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}
export function useResetUserPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: PasswordReset }) => api.resetUserPassword(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}
