import { useEffect, useState } from 'react';
import { Button, Group, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { useDebouncedValue } from '@mantine/hooks';
import { useDeviceTemplates, useDeviceTypes, useDevices, useTags, useVlans } from '../api/hooks';
import { flattenTagsOrdered } from '../lib/utils';
import { DeviceCard, typeNameForTemplate } from './devices/DeviceCard';
import { DeviceFormModal } from './devices/DeviceFormModal';
import type { DeviceListItem } from '../api/types';
import { useCan } from '../auth/permissions';

const PAGE = 50;

/** Спецификация оборудования.
 *
 * Отбор, поиск и постраничность считает сервер: на тысяче устройств
 * фильтровать в браузере можно, только сначала привезя туда всё вместе с
 * портами — а это и делало страницу неподъёмной.
 */
export function DevicesPage() {
  const canEdit = useCan('edit');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // Пока человек печатает, запрос не уходит на каждую букву.
  const [debouncedSearch] = useDebouncedValue(search, 300);
  const [shown, setShown] = useState(PAGE);
  const [editing, setEditing] = useState<DeviceListItem | 'new' | null>(null);

  // Сменили условия отбора — начинаем показ заново, иначе «показать ещё»
  // продолжало бы список, которого уже нет.
  useEffect(() => setShown(PAGE), [tagFilter, typeFilter, debouncedSearch]);

  const { data, isLoading } = useDevices({
    q: debouncedSearch.trim() || undefined,
    tag_id: tagFilter ? parseInt(tagFilter, 10) : undefined,
    device_type_id: typeFilter ? parseInt(typeFilter, 10) : undefined,
    limit: shown,
  });
  const devices = data?.items ?? [];
  const total = data?.total ?? 0;

  const { data: templates = [] } = useDeviceTemplates();
  const { data: types = [] } = useDeviceTypes();
  const { data: vlans = [] } = useVlans();
  const { data: tags = [] } = useTags();

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Title order={2}>Устройства</Title>
          <Text c="dimmed">{total}</Text>
        </Group>
        <Group>
          <TextInput
            placeholder="Код, имя, IP, расположение" w={260}
            leftSection={<IconSearch size={16} />}
            value={search} onChange={(e) => setSearch(e.currentTarget.value)}
          />
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
        {devices.map((d) => {
          const template = templates.find((t) => t.id === d.template_id);
          return (
            <DeviceCard
              key={d.id}
              device={d}
              template={template}
              typeName={typeNameForTemplate(template, types)}
              vlans={vlans}
              onEdit={() => setEditing(d)}
            />
          );
        })}
        {devices.length === 0 && (
          <Text c="dimmed">{isLoading ? 'Загрузка…' : 'Нет устройств по выбранным условиям.'}</Text>
        )}
      </Stack>

      {devices.length < total && (
        <Group justify="center">
          <Button variant="default" onClick={() => setShown((n) => n + PAGE)}>
            Показать ещё ({total - devices.length})
          </Button>
        </Group>
      )}

      {editing && (
        <DeviceFormModal
          device={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Stack>
  );
}
