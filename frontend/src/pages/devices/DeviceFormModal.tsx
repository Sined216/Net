import { useState } from 'react';
import {
  Badge, Button, Checkbox, Group, Modal, ScrollArea, Select, Stack, Table, Text, TextInput, Textarea,
} from '@mantine/core';
import { IconPencil, IconPlus } from '@tabler/icons-react';
import {
  useConnectorTypes, useCreateDevice, useDeviceInterfaces, useDeviceTemplates, useDeviceTypes,
  useMoveImportRow, useSetDeviceTags, useTags, useTopologyGroups, useUpdateDevice,
} from '../../api/hooks';
import { TemplateFormModal } from '../TemplatesPage';
import { TemplatePicker } from './TemplatePicker';
import { flattenTagsOrdered, nn } from '../../lib/utils';
import { notifyError, notifySuccess } from '../../lib/notify';
import { deviceRoleLabel } from '../../lib/enumLabels';
import { useCan } from '../../auth/permissions';
import type { DeviceOut, DeviceRole, DeviceListItem } from '../../api/types';

const ROLES: { value: DeviceRole; label: string }[] = (['core', 'distribution', 'access'] as const)
  .map((value) => ({ value, label: deviceRoleLabel(value) }));

/** Заготовка для нового устройства — например разобранная строка файла.
 * Всё необязательно: чего нет, человек заполнит руками. */
export interface DeviceDraft {
  template_id?: number | null;
  name?: string | null;
  management_ip?: string | null;
  mac?: string | null;
  role?: string | null;
  notes?: string | null;
  topology_group_id?: number | null;
  tag_ids?: number[];
}


export function DeviceFormModal({ device, onClose, onCreated, draft, importRowId }: {
  /** Правится существующее устройство или заводится новое. Хватает лёгкой
   * записи из списка: в форме нет ни одного поля, которого в ней нет. */
  device: DeviceOut | DeviceListItem | null;
  onClose: () => void;
  /** Позволяет вызвавшей странице доделать своё — например схеме поставить
   * новый узел туда, куда человек смотрит. */
  onCreated?: (deviceId: number) => void;
  /** Чем заполнить поля нового устройства. */
  draft?: DeviceDraft;
  /** Строка импорта, из которой заводится устройство: тогда создание идёт
   * через неё, и строка одной операцией помечается перенесённой. Иначе
   * пометка могла бы не доехать — и строка осталась бы «не разобранной»
   * при уже заведённом устройстве. */
  importRowId?: number;
}) {
  const isEdit = !!device;
  const canEdit = useCan('edit');
  const { data: templates = [] } = useDeviceTemplates();
  const { data: deviceTypes = [] } = useDeviceTypes();
  const { data: tags = [] } = useTags();
  const { data: topologyGroups = [] } = useTopologyGroups();
  const { data: connectors = [] } = useConnectorTypes();
  const [templateId, setTemplateId] = useState<string | null>(
    draft?.template_id != null ? String(draft.template_id) : null,
  );
  const [name, setName] = useState(device?.name ?? draft?.name ?? '');
  const [mgmtIp, setMgmtIp] = useState(device?.management_ip ?? draft?.management_ip ?? '');
  const [mac, setMac] = useState(device?.mac ?? draft?.mac ?? '');
  const [role, setRole] = useState<string | null>(device?.role ?? draft?.role ?? null);
  const [notes, setNotes] = useState(device?.notes ?? draft?.notes ?? '');
  const [groupId, setGroupId] = useState<string | null>(
    device?.topology_group_id != null ? String(device.topology_group_id)
      : draft?.topology_group_id != null ? String(draft.topology_group_id) : null,
  );
  // 'edit' — правка уже выбранного шаблона, 'new' — заведение нового прямо
  // отсюда, чтобы не бросать начатую форму устройства ради похода на другую
  // вкладку.
  const [templateModal, setTemplateModal] = useState<'edit' | 'new' | null>(null);
  const [tagIds, setTagIds] = useState<Set<number>>(
    new Set(device ? (device.tags ?? []).map((t) => t.id) : (draft?.tag_ids ?? [])),
  );

  const createDevice = useCreateDevice();
  const moveImportRow = useMoveImportRow();
  const updateDevice = useUpdateDevice();
  const setDeviceTags = useSetDeviceTags();

  const template = isEdit
    ? templates.find((t) => t.id === device!.template_id) ?? null
    : templates.find((t) => String(t.id) === templateId) ?? null;
  const pending = createDevice.isPending || updateDevice.isPending || setDeviceTags.isPending
    || moveImportRow.isPending;

  // У заведённого устройства порты берутся его собственные, а не шаблонные:
  // у моделей со сменным составом они успевают разойтись с шаблоном, да и
  // занятость порта видна только у железки.
  const { data: devicePorts = [] } = useDeviceInterfaces(isEdit ? device!.id : null);
  const ports: PreviewPort[] = isEdit
    ? devicePorts.map((port) => ({
      key: port.id,
      number: port.port_number,
      label: port.label,
      connector: (port.connector_effective ?? port.connector)?.name ?? null,
      busy: port.link_id != null,
    }))
    : (template?.interfaces ?? []).map((iface) => ({
      key: iface.id,
      number: iface.port_number,
      label: iface.label,
      connector: connectors.find((c) => c.id === iface.connector_id)?.name ?? null,
      busy: false,
    }));

  function toggleTag(id: number) {
    setTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      name: nn(name),
      management_ip: nn(mgmtIp),
      mac: nn(mac),
      role: (role as DeviceRole) || null,
      notes: nn(notes),
      topology_group_id: groupId ? parseInt(groupId, 10) : null,
    };
    if (isEdit) {
      // Номер правки, который был на экране: если кто-то сохранил раньше,
      // сервер отобьёт правку, а не даст затереть чужую. Теги уходят вторым
      // запросом уже с новым номером — из ответа первого.
      updateDevice.mutate(
        { id: device!.id, body: { ...body, version: device!.version } },
        {
          onSuccess: (saved) => {
            setDeviceTags.mutate(
              { id: device!.id, body: { tag_ids: [...tagIds], version: saved.version } },
              { onSuccess: () => { notifySuccess('Устройство обновлено'); onClose(); }, onError: notifyError },
            );
          },
          onError: notifyError,
        },
      );
    } else {
      if (!templateId) { notifyError(new Error('Выберите шаблон устройства')); return; }
      const created = { ...body, template_id: parseInt(templateId, 10), tag_ids: [...tagIds] };
      const handlers = {
        onSuccess: (device: DeviceOut) => {
          onCreated?.(device.id);
          notifySuccess(importRowId ? `Устройство ${device.code} заведено` : 'Устройство создано');
          onClose();
        },
        onError: notifyError,
      };
      if (importRowId) moveImportRow.mutate({ rowId: importRowId, body: created }, handlers);
      else createDevice.mutate(created, handlers);
    }
  }

  return (
    <Modal opened onClose={onClose} title={isEdit ? `Устройство: ${device!.code}` : 'Новое устройство'} size="md">
      <form onSubmit={handleSubmit}>
        <Stack>
          {!isEdit ? (
            <>
              <TemplatePicker
                label="Шаблон устройства" placeholder="— выбрать или найти —" required
                templates={templates} deviceTypes={deviceTypes}
                value={templateId} onChange={setTemplateId}
              />
              <Group gap={6}>
                <Text size="xs" c="dimmed">Нет нужного шаблона?</Text>
                {canEdit && (
                  <Button
                    size="compact-xs" variant="subtle" leftSection={<IconPlus size={13} />}
                    onClick={() => setTemplateModal('new')}
                  >
                    Создать шаблон
                  </Button>
                )}
                {template && canEdit && (
                  <Button
                    size="compact-xs" variant="subtle" leftSection={<IconPencil size={13} />}
                    onClick={() => setTemplateModal('edit')}
                  >
                    Править шаблон
                  </Button>
                )}
              </Group>
            </>
          ) : (
            <Group gap={6}>
              <Text size="sm" c="dimmed">Шаблон: {template?.name ?? '—'} (после создания не меняется)</Text>
              {template && canEdit && (
                <Button
                  size="compact-xs" variant="subtle" leftSection={<IconPencil size={13} />}
                  onClick={() => setTemplateModal('edit')}
                >
                  Править шаблон
                </Button>
              )}
            </Group>
          )}
          <TextInput label="Название" placeholder="необязательно" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <Group grow>
            <TextInput label="IP управления" value={mgmtIp} onChange={(e) => setMgmtIp(e.currentTarget.value)} />
            <Select label="Роль" data={ROLES} value={role} onChange={setRole} clearable />
          </Group>
          <TextInput
            label="MAC-адрес"
            description="Управляющий адрес железки, не порта. Разделители любые — запись приводится к одному виду"
            placeholder="a4:bb:6d:11:22:33"
            value={mac} onChange={(e) => setMac(e.currentTarget.value)}
          />
          {/* «Расположение» свободным текстом отсюда убрано: место железки
              задаёт группа на топологии — она проверяемая, вложенная и видна
              на схеме, а два способа записать одно и то же расходились при
              первой же правке. */}
          <Select
            label="Группа на топологии" placeholder="— без группы —" clearable
            data={topologyGroups.map((g) => ({ value: String(g.id), label: g.name }))}
            value={groupId} onChange={setGroupId}
          />
          <Textarea label="Заметки" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} rows={2} />
          <div>
            <Text size="sm" fw={500} mb={4}>Теги</Text>
            <ScrollArea.Autosize mah={200} className="tag-picker-scroll" style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 8, padding: 8 }}>
              <Stack gap={4}>
                {flattenTagsOrdered(tags).map(({ tag, depth }) => (
                  <Checkbox
                    key={tag.id}
                    label={`${'—'.repeat(depth)} ${tag.name}`}
                    checked={tagIds.has(tag.id)}
                    onChange={() => toggleTag(tag.id)}
                  />
                ))}
                {tags.length === 0 && <Text size="sm" c="dimmed">Тегов ещё нет — можно завести во вкладке «Теги».</Text>}
              </Stack>
            </ScrollArea.Autosize>
          </div>
          <PortsPreview ports={ports} hasTemplate={!!template} isEdit={isEdit} />
          <Group justify="flex-end" mt="sm">
            <Button type="submit" loading={pending}>{isEdit ? 'Сохранить' : 'Создать'}</Button>
          </Group>
        </Stack>
      </form>
      {/* Заведение и правка шаблона прямо отсюда: состав портов задаёт
          шаблон, и заметив нехватку модели или порта в списке ниже, незачем
          уходить на другую вкладку и терять начатое заведение устройства. */}
      {templateModal === 'edit' && template && (
        <TemplateFormModal template={template} onClose={() => setTemplateModal(null)} />
      )}
      {templateModal === 'new' && (
        <TemplateFormModal
          template={null}
          onClose={() => setTemplateModal(null)}
          onCreated={(id) => setTemplateId(String(id))}
        />
      )}
    </Modal>
  );
}

/** Порт в списке под формой — одинаково и для шаблонного, и для настоящего. */
interface PreviewPort {
  key: number;
  number: number;
  label: string;
  connector: string | null;
  busy: boolean;
}

/** Что за порты будут (или уже есть) у устройства.
 *
 * Состав портов задаётся шаблоном, поэтому здесь он только показан: выбрал
 * шаблон — сразу видно, то ли это железо. Без этого списка ошибку в выборе
 * модели замечали уже на карточке устройства, когда порты заведены и часть
 * из них воткнута.
 */
function PortsPreview({ ports, hasTemplate, isEdit }: {
  ports: PreviewPort[];
  hasTemplate: boolean;
  isEdit: boolean;
}) {
  return (
    <div>
      <Group gap={6} mb={4}>
        <Text size="sm" fw={500}>Порты</Text>
        {hasTemplate && <Badge size="xs" variant="light" color="gray">{ports.length}</Badge>}
      </Group>
      {!hasTemplate ? (
        <Text size="sm" c="dimmed">Выберите шаблон устройства — порты появятся здесь.</Text>
      ) : ports.length === 0 ? (
        <Text size="sm" c="dimmed">У шаблона нет портов — их можно добавить во вкладке «Шаблоны».</Text>
      ) : (
        <ScrollArea.Autosize
          mah={220}
          style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 8 }}
        >
          <Table verticalSpacing={4} horizontalSpacing="sm" striped stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={44}>№</Table.Th>
                <Table.Th>Название</Table.Th>
                <Table.Th w={110}>Разъём</Table.Th>
                {isEdit && <Table.Th w={90} />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {ports.map((port) => (
                <Table.Tr key={port.key}>
                  <Table.Td><Text size="xs" c="dimmed">{port.number}</Text></Table.Td>
                  <Table.Td><Text size="sm">{port.label}</Text></Table.Td>
                  <Table.Td><Text size="sm" c={port.connector ? undefined : 'dimmed'}>{port.connector ?? '—'}</Text></Table.Td>
                  {isEdit && (
                    <Table.Td>
                      {port.busy && <Badge size="xs" color="teal" variant="light">занят</Badge>}
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
      )}
      <Text size="xs" c="dimmed" mt={4}>
        {isEdit
          ? 'Состав портов задаётся шаблоном; настройки порта правятся в карточке устройства.'
          : 'Порты заведутся вместе с устройством.'}
      </Text>
    </div>
  );
}
