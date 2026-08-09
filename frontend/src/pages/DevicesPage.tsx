import { useMemo, useState } from 'react';
import { Button, Group, Select, Stack, Text, Title } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { useDeviceTemplates, useDeviceTypes, useDevices, useTags, useVlans } from '../api/hooks';
import { flattenTagsOrdered } from '../lib/utils';
import { DeviceCard, typeNameForTemplate } from './devices/DeviceCard';
import { DeviceFormModal } from './devices/DeviceFormModal';
import type { FreeEntry } from './devices/InterfaceRow';
import type { DeviceOut } from '../api/types';
import { useCan } from '../auth/permissions';

export function DevicesPage() {
  const canEdit = useCan('edit');
  const { data: devices = [] } = useDevices();
  const { data: templates = [] } = useDeviceTemplates();
  const { data: types = [] } = useDeviceTypes();
  const { data: vlans = [] } = useVlans();
  const { data: tags = [] } = useTags();

  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<DeviceOut | 'new' | null>(null);

  const freeEntries: FreeEntry[] = useMemo(() => {
    const out: FreeEntry[] = [];
    // Свободен тот порт, в котором нет кабеля вообще. Подвешенный кабель
    // тоже воткнут — такой порт занят, хоть на другом конце и пусто.
    for (const d of devices) for (const i of d.interfaces) if (!i.link_id) out.push({ device: d, iface: i });
    return out;
  }, [devices]);

  const filtered = devices
    .filter((d) => !tagFilter || d.tags.some((t) => String(t.id) === tagFilter))
    .filter((d) => {
      if (!typeFilter) return true;
      const tpl = templates.find((t) => t.id === d.template_id);
      return tpl ? String(tpl.device_type_id) === typeFilter : false;
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Title order={2}>Устройства</Title>
        <Group>
          <Select
            placeholder="Все теги" clearable w={200}
            data={flattenTagsOrdered(tags).map(({ tag, depth }) => ({ value: String(tag.id), label: `${'—'.repeat(depth)} ${tag.name}` }))}
            value={tagFilter} onChange={setTagFilter}
          />
          <Select
            placeholder="Все типы" clearable w={180}
            data={types.map((t) => ({ value: String(t.id), label: t.name }))}
            value={typeFilter} onChange={setTypeFilter}
          />
          {canEdit && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>Устройство</Button>
          )}
        </Group>
      </Group>

      <Stack gap="xs">
        {filtered.map((d) => {
          const template = templates.find((t) => t.id === d.template_id);
          return (
            <DeviceCard
              key={d.id}
              device={d}
              template={template}
              typeName={typeNameForTemplate(template, types)}
              vlans={vlans}
              freeEntries={freeEntries}
              onEdit={() => setEditing(d)}
            />
          );
        })}
        {filtered.length === 0 && <Text c="dimmed">Нет устройств по выбранным фильтрам.</Text>}
      </Stack>

      {editing && <DeviceFormModal device={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Stack>
  );
}
