import { useState } from 'react';
import { Button, Checkbox, Group, Modal, ScrollArea, Select, Stack, Text, TextInput, Textarea } from '@mantine/core';
import {
  useCreateDevice, useDeviceTemplates, useMoveImportRow, useSetDeviceTags, useTags, useTopologyGroups,
  useUpdateDevice,
} from '../../api/hooks';
import { flattenTagsOrdered, nn } from '../../lib/utils';
import { notifyError, notifySuccess } from '../../lib/notify';
import type { DeviceOut, DeviceRole, DeviceListItem } from '../../api/types';

const ROLES: { value: DeviceRole; label: string }[] = [
  { value: 'core', label: 'core' },
  { value: 'distribution', label: 'distribution' },
  { value: 'access', label: 'access' },
];

/** Заготовка для нового устройства — например разобранная строка файла.
 * Всё необязательно: чего нет, человек заполнит руками. */
export interface DeviceDraft {
  template_id?: number | null;
  name?: string | null;
  management_ip?: string | null;
  location?: string | null;
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
  const { data: templates = [] } = useDeviceTemplates();
  const { data: tags = [] } = useTags();
  const { data: topologyGroups = [] } = useTopologyGroups();
  const [templateId, setTemplateId] = useState<string | null>(
    draft?.template_id != null ? String(draft.template_id) : null,
  );
  const [name, setName] = useState(device?.name ?? draft?.name ?? '');
  const [mgmtIp, setMgmtIp] = useState(device?.management_ip ?? draft?.management_ip ?? '');
  const [role, setRole] = useState<string | null>(device?.role ?? null);
  const [location, setLocation] = useState(device?.location ?? draft?.location ?? '');
  const [notes, setNotes] = useState(device?.notes ?? draft?.notes ?? '');
  const [groupId, setGroupId] = useState<string | null>(
    device?.topology_group_id != null ? String(device.topology_group_id)
      : draft?.topology_group_id != null ? String(draft.topology_group_id) : null,
  );
  const [tagIds, setTagIds] = useState<Set<number>>(
    new Set(device ? (device.tags ?? []).map((t) => t.id) : (draft?.tag_ids ?? [])),
  );

  const createDevice = useCreateDevice();
  const moveImportRow = useMoveImportRow();
  const updateDevice = useUpdateDevice();
  const setDeviceTags = useSetDeviceTags();

  const template = isEdit ? templates.find((t) => t.id === device!.template_id) : null;
  const pending = createDevice.isPending || updateDevice.isPending || setDeviceTags.isPending
    || moveImportRow.isPending;

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
      location: nn(location),
      role: (role as DeviceRole) || null,
      notes: nn(notes),
      topology_group_id: groupId ? parseInt(groupId, 10) : null,
    };
    if (isEdit) {
      updateDevice.mutate(
        { id: device!.id, body },
        {
          onSuccess: () => {
            setDeviceTags.mutate(
              { id: device!.id, body: { tag_ids: [...tagIds] } },
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
              <Select
                label="Шаблон устройства" placeholder="— выбрать —" required
                data={[...templates].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({
                  value: String(t.id), label: `${t.name} (${t.interfaces.length} порт.)`,
                }))}
                value={templateId} onChange={setTemplateId}
              />
              <Text size="xs" c="dimmed">Нет нужного шаблона? Сначала заведите его во вкладке «Шаблоны».</Text>
            </>
          ) : (
            <Text size="sm" c="dimmed">Шаблон: {template?.name ?? '—'} (после создания не меняется)</Text>
          )}
          <TextInput label="Название" placeholder="необязательно" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <Group grow>
            <TextInput label="IP управления" value={mgmtIp} onChange={(e) => setMgmtIp(e.currentTarget.value)} />
            <Select label="Роль" data={ROLES} value={role} onChange={setRole} clearable />
          </Group>
          <Group grow>
            <TextInput label="Расположение" placeholder="цех / шкаф" value={location} onChange={(e) => setLocation(e.currentTarget.value)} />
            <Select
              label="Группа на топологии" placeholder="— без группы —" clearable
              data={topologyGroups.map((g) => ({ value: String(g.id), label: g.name }))}
              value={groupId} onChange={setGroupId}
            />
          </Group>
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
          <Group justify="flex-end" mt="sm">
            <Button type="submit" loading={pending}>{isEdit ? 'Сохранить' : 'Создать'}</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
