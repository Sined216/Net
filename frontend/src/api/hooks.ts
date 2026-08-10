import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './endpoints';
import type {
  TagCreate, TagUpdate,
  DeviceTypeCreate, DeviceTypeUpdate,
  ConnectorTypeCreate, ConnectorTypeUpdate,
  TransceiverModuleCreate, TransceiverModuleUpdate,
  InterfaceTemplateUpdate, PortsBulkCreate,
  VlanCreate,
  DeviceTemplateCreate, DeviceTemplateUpdate, InterfaceTemplateCreate,
  DeviceCreate, DeviceUpdate, DeviceTagsUpdate, DevicePositionUpdate,
  InterfaceCreate, InterfaceUpdate,
  LinkTemplateCreate, LinkTemplateUpdate,
  LinkCreate, LinkUpdate,
  TopologyGroupCreate, TopologyGroupUpdate, TopologyGroupBox, TopologyGroupOut,
  UserCreate, UserUpdate, PasswordReset,
  SiteCreate, SiteUpdate, AuditQuery, DeviceQuery, LinkQuery, FreePortQuery,
} from './types';

// ---------- Queries ----------
export const useTags = () => useQuery({ queryKey: ['tags'], queryFn: api.listTags });
export const useDeviceTypes = () => useQuery({ queryKey: ['deviceTypes'], queryFn: api.listDeviceTypes });
export const useConnectorTypes = () => useQuery({ queryKey: ['connectorTypes'], queryFn: api.listConnectorTypes });
export const useModules = () => useQuery({ queryKey: ['modules'], queryFn: api.listModules });
export const useImportRows = () => useQuery({ queryKey: ['importRows'], queryFn: api.listImportRows });
export const useVlans = () => useQuery({ queryKey: ['vlans'], queryFn: api.listVlans });
export const useDeviceTemplates = () => useQuery({ queryKey: ['deviceTemplates'], queryFn: api.listDeviceTemplates });
/** Список устройств — страницами и без портов. */
export const useDevices = (query: DeviceQuery = {}) =>
  useQuery({ queryKey: ['devices', query], queryFn: () => api.listDevices(query) });
/** Одно устройство целиком — для его страницы. Раньше она искала нужное
 * среди всех устройств, то есть везла всю спецификацию ради одной железки. */
export const useDevice = (id: number | null) =>
  useQuery({ queryKey: ['device', id], queryFn: () => api.getDevice(id!), enabled: id != null && !Number.isNaN(id) });
/** Устройства со всеми портами — для схемы связей и её окон. */
export const useTopologyDevices = () =>
  useQuery({ queryKey: ['topologyDevices'], queryFn: api.listTopologyDevices });
/** Порты одного устройства — подтягиваются, когда карточку раскрывают. */
export const useDeviceInterfaces = (deviceId: number | null) =>
  useQuery({
    queryKey: ['deviceInterfaces', deviceId],
    queryFn: () => api.listInterfaces(deviceId!),
    enabled: deviceId != null,
  });
/** Свободные порты для подключения — ищет база, а не браузер. */
export const useFreePorts = (query: FreePortQuery, enabled = true) =>
  useQuery({ queryKey: ['freePorts', query], queryFn: () => api.listFreePorts(query), enabled });
export const useLinks = (query: LinkQuery = {}) =>
  useQuery({ queryKey: ['links', query], queryFn: () => api.listLinks(query) });
export const useLinkTemplates = () => useQuery({ queryKey: ['linkTemplates'], queryFn: api.listLinkTemplates });
export const useTopologyGroups = () => useQuery({ queryKey: ['topologyGroups'], queryFn: api.listTopologyGroups });
export const useDatabaseSchema = () => useQuery({ queryKey: ['schema'], queryFn: api.getDatabaseSchema });
/** Список людей отдаётся только администратору, поэтому вызывающий может
 * его отключить — иначе страница, доступная всем, ловила бы 403. */
export const useUsers = (enabled = true) =>
  useQuery({ queryKey: ['users'], queryFn: api.listUsers, enabled });
/** Сколько устройств и подключённых портов заденет правка портов модели. */
export const useTemplateImpact = (id: number | null) =>
  useQuery({ queryKey: ['templateImpact', id], queryFn: () => api.templateImpact(id!), enabled: id != null });

/** Ключи, которые нужно освежить после почти любой мутации.
 *
 * Одного `devices` мало: тот же набор данных живёт в нескольких запросах —
 * лёгкий список, порты раскрытой карточки, свободные порты для подключения
 * и полный набор для схемы связей. Пока схема была тем же запросом, что и
 * список, это сходило с рук; после разделения заведённое устройство
 * появлялось на схеме только после перезагрузки страницы. */
const CORE_KEYS = ['devices', 'links', 'deviceInterfaces', 'freePorts', 'topologyDevices'] as const;

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

export function useUpdateDeviceType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: DeviceTypeUpdate }) => api.updateDeviceType(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deviceTypes'] }),
  });
}

// ---------- Разъёмы и модули ----------
export function useCreateConnectorType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ConnectorTypeCreate) => api.createConnectorType(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connectorTypes'] }),
  });
}
export function useUpdateConnectorType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: ConnectorTypeUpdate }) => api.updateConnectorType(id, body),
    // Разъём виден и в шаблонах, и в портах устройств.
    onSuccess: () => invalidateAll(qc, ['connectorTypes', 'deviceTemplates', 'devices']),
  });
}
export function useDeleteConnectorType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteConnectorType(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connectorTypes'] }),
  });
}
export function useCreateModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TransceiverModuleCreate) => api.createModule(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modules'] }),
  });
}
export function useUpdateModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: TransceiverModuleUpdate }) => api.updateModule(id, body),
    onSuccess: () => invalidateAll(qc, ['modules', 'devices']),
  });
}
export function useDeleteModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteModule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modules'] }),
  });
}

// ---------- Импорт устройств из файла ----------
export function useUploadImportFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.uploadImportFile(file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['importRows'] }),
  });
}
export function useMoveImportRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rowId, body }: { rowId: number; body: DeviceCreate }) => api.moveImportRow(rowId, body),
    // Появилось устройство — списки и схема устарели, строка сменила статус.
    onSuccess: () => invalidateAll(qc, ['importRows', 'devices']),
  });
}
export function useDeleteImportRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rowId: number) => api.deleteImportRow(rowId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['importRows'] }),
  });
}
export function useClearImportRows() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status?: 'new' | 'moved') => api.clearImportRows(status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['importRows'] }),
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
    // Порт добавляется и всем устройствам этой модели — списки устройств и
    // связей тоже устарели.
    onSuccess: () => invalidateAll(qc, ['deviceTemplates', 'devices', 'links']),
  });
}
export function useUpdateTemplateInterface() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, ifaceId, body }: { templateId: number; ifaceId: number; body: InterfaceTemplateUpdate }) =>
      api.updateTemplateInterface(templateId, ifaceId, body),
    // Правка порта модели доезжает до всех её устройств.
    onSuccess: () => invalidateAll(qc, ['deviceTemplates', 'devices']),
  });
}
export function useAddTemplateInterfacesBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, body }: { templateId: number; body: PortsBulkCreate }) =>
      api.addTemplateInterfacesBulk(templateId, body),
    onSuccess: () => invalidateAll(qc, ['deviceTemplates', 'devices', 'links']),
  });
}
export function useAddInterfacesBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ deviceId, body }: { deviceId: number; body: PortsBulkCreate }) =>
      api.addInterfacesBulk(deviceId, body),
    onSuccess: () => invalidateAll(qc, CORE_KEYS),
  });
}
export function useCopyDeviceTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.copyDeviceTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deviceTemplates'] }),
  });
}
export function useDeleteTemplateInterface() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, ifaceId }: { templateId: number; ifaceId: number }) =>
      api.deleteTemplateInterface(templateId, ifaceId),
    // Порт исчезает у всех устройств модели, а их кабели повисают.
    onSuccess: () => invalidateAll(qc, ['deviceTemplates', 'devices', 'links']),
  });
}

// ---------- Devices ----------
export function useCreateDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DeviceCreate) => api.createDevice(body),
    onSuccess: () => invalidateAll(qc, CORE_KEYS),
  });
}
export function useUpdateDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: DeviceUpdate }) => api.updateDevice(id, body),
    onSuccess: () => invalidateAll(qc, CORE_KEYS),
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
    onSuccess: () => invalidateAll(qc, CORE_KEYS),
  });
}
export function useAddInterface() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ deviceId, body }: { deviceId: number; body: InterfaceCreate }) => api.addInterface(deviceId, body),
    onSuccess: () => invalidateAll(qc, CORE_KEYS),
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
/** Положение узла на схеме.
 *
 * Намеренно ничего не освежает: схема уже показывает узел там, куда его
 * отпустили, а перечитывание всех устройств на каждое перетаскивание — это
 * мегабайты трафика ради того, что и так на экране. */
export function useUpdateDevicePosition() {
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: DevicePositionUpdate }) => api.updateDevicePosition(id, body),
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
export function useSetTopologyGroupBox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: TopologyGroupBox }) => api.setTopologyGroupBox(id, body),
    // Новая рамка кладётся прямо в кэш, не дожидаясь ответа и без повторного
    // запроса списка. Иначе схема, перерисованная по любой другой причине
    // (а положение устройств меняется тут же, вместе с рамкой), брала бы из
    // кэша прежние координаты — и рамка прыгала бы обратно.
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: ['topologyGroups'] });
      const previous = qc.getQueryData<TopologyGroupOut[]>(['topologyGroups']);
      qc.setQueryData<TopologyGroupOut[]>(['topologyGroups'], (groups) =>
        (groups ?? []).map((g) => (g.id === id ? { ...g, ...body } : g)));
      return { previous };
    },
    onError: (_error, _variables, context) => {
      // Сервер не принял — возвращаем то, что было, иначе схема показывала
      // бы рамку там, где её нет.
      if (context?.previous) qc.setQueryData(['topologyGroups'], context.previous);
    },
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
export function useAttachLinkEnd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, interfaceId }: { id: number; interfaceId: number }) => api.attachLinkEnd(id, interfaceId),
    onSuccess: () => invalidateAll(qc, CORE_KEYS),
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

// ---------- Площадки ----------
export const useSites = () => useQuery({ queryKey: ['sites'], queryFn: api.listSites });
export const useSiteAccess = (id: number | null) =>
  useQuery({ queryKey: ['siteAccess', id], queryFn: () => api.listSiteAccess(id!), enabled: id != null });

export function useCreateSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SiteCreate) => api.createSite(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sites'] }),
  });
}
export function useUpdateSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: SiteUpdate }) => api.updateSite(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sites'] }),
  });
}
export function useDeleteSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteSite(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sites'] }),
  });
}
export function useSetSiteAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, userIds }: { id: number; userIds: number[] }) => api.setSiteAccess(id, userIds),
    onSuccess: (_data, { id }) => qc.invalidateQueries({ queryKey: ['siteAccess', id] }),
  });
}

// ---------- Журнал изменений ----------
export const useAudit = (query: AuditQuery) =>
  useQuery({ queryKey: ['audit', query], queryFn: () => api.listAudit(query) });
