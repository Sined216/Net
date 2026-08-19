import { useEffect, useState } from 'react';
import { Alert, Button, Group, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconFilterOff, IconPlus } from '@tabler/icons-react';
import { useDebouncedValue } from '@mantine/hooks';
import {
  useDeviceTemplates, useDeviceTypes, useDevices, useTags, useTopologyGroups, useVlans,
} from '../api/hooks';
import { flattenTagsOrdered } from '../lib/utils';
import { DeviceRow, typeNameForTemplate } from './devices/DeviceRow';
import { DeviceFormModal } from './devices/DeviceFormModal';
import { TemplateFormModal } from './TemplatesPage';
import type { DeviceListItem } from '../api/types';
import { useCan } from '../auth/permissions';
import { EquipmentTabs } from './equipment/EquipmentTabs';

const PAGE = 50;
const COLUMNS = 10;

/** Текстовые условия отбора — по одному на колонку. */
const EMPTY_TEXT = { code: '', name: '', management_ip: '', mac: '' };
/** Выбор из справочника — тоже по колонке. */
const EMPTY_PICKED: Record<'template' | 'type' | 'group' | 'tag', string | null> = {
  template: null, type: null, group: null, tag: null,
};

/** Спецификация оборудования.
 *
 * Таблицей, а не карточками: одинаковые сведения у соседних устройств должны
 * стоять в столбец, иначе сравнить две железки можно только глазами по
 * бегущему тексту. Под каждым заголовком своё поле отбора, и условия
 * складываются.
 *
 * Отбор, поиск и постраничность считает сервер: на тысяче устройств
 * фильтровать в браузере можно, только сначала привезя туда всё вместе с
 * портами — а это и делало страницу неподъёмной.
 */
export function DevicesPage() {
  const canEdit = useCan('edit');
  const [text, setText] = useState(EMPTY_TEXT);
  const [picked, setPicked] = useState(EMPTY_PICKED);
  // Пока человек печатает, запрос не уходит на каждую букву.
  const [debouncedText] = useDebouncedValue(text, 300);
  const [shown, setShown] = useState(PAGE);
  const [editing, setEditing] = useState<DeviceListItem | 'new' | null>(null);
  const [addingTemplate, setAddingTemplate] = useState(false);

  // Сменили условия отбора — начинаем показ заново, иначе «показать ещё»
  // продолжало бы список, которого уже нет.
  useEffect(() => setShown(PAGE), [debouncedText, picked]);

  const { data, isLoading, error } = useDevices({
    code: debouncedText.code.trim() || undefined,
    name: debouncedText.name.trim() || undefined,
    management_ip: debouncedText.management_ip.trim() || undefined,
    mac: debouncedText.mac.trim() || undefined,
    template_id: picked.template ? parseInt(picked.template, 10) : undefined,
    device_type_id: picked.type ? parseInt(picked.type, 10) : undefined,
    topology_group_id: picked.group ? parseInt(picked.group, 10) : undefined,
    tag_id: picked.tag ? parseInt(picked.tag, 10) : undefined,
    limit: shown,
  });
  const devices = data?.items ?? [];
  const total = data?.total ?? 0;

  const { data: templates = [] } = useDeviceTemplates();
  const { data: types = [] } = useDeviceTypes();
  const { data: groups = [] } = useTopologyGroups();
  const { data: vlans = [] } = useVlans();
  const { data: tags = [] } = useTags();

  const filtered = Object.values(text).some(Boolean) || Object.values(picked).some(Boolean);
  const setField = (key: keyof typeof text, value: string) => setText((prev) => ({ ...prev, [key]: value }));
  const setPick = (key: keyof typeof picked, value: string | null) =>
    setPicked((prev) => ({ ...prev, [key]: value }));

  return (
    <Stack>
      <EquipmentTabs />
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Title order={2}>Устройства</Title>
          <Text c="dimmed">{total}</Text>
        </Group>
        <Group>
          {filtered && (
            <Button
              variant="subtle" leftSection={<IconFilterOff size={16} />}
              onClick={() => { setText(EMPTY_TEXT); setPicked(EMPTY_PICKED); }}
            >
              Сбросить отбор
            </Button>
          )}
          {canEdit && (
            <>
              {/* Шаблон заводится отсюда же, как пресет кабеля на вкладке
                  «Связи»: новую железку заносят, когда она приехала, а модели
                  такой ещё нет — и уходить за ней на другую вкладку незачем. */}
              <Button
                variant="light" leftSection={<IconPlus size={16} />}
                onClick={() => setAddingTemplate(true)}
              >
                Шаблон
              </Button>
              <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>Устройство</Button>
            </>
          )}
        </Group>
      </Group>

      {error && <Alert color="red">{(error as Error).message}</Alert>}

      <Table.ScrollContainer minWidth={1100}>
        <Table withTableBorder verticalSpacing="xs" horizontalSpacing="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={130}>Код</Table.Th>
              <Table.Th>Название</Table.Th>
              <Table.Th>Шаблон</Table.Th>
              <Table.Th w={130}>Тип</Table.Th>
              <Table.Th w={130}>IP</Table.Th>
              <Table.Th w={150}>MAC</Table.Th>
              <Table.Th w={140}>Группа</Table.Th>
              <Table.Th>Теги</Table.Th>
              <Table.Th w={80}>Порты</Table.Th>
              <Table.Th w={100} />
            </Table.Tr>
            <Table.Tr>
              <Table.Th>
                <TextInput
                  size="xs" placeholder="SW-" value={text.code}
                  onChange={(e) => setField('code', e.currentTarget.value)}
                />
              </Table.Th>
              <Table.Th>
                <TextInput
                  size="xs" placeholder="часть названия" value={text.name}
                  onChange={(e) => setField('name', e.currentTarget.value)}
                />
              </Table.Th>
              <Table.Th>
                <Select
                  size="xs" placeholder="все" clearable searchable
                  data={[...templates].sort((a, b) => a.name.localeCompare(b.name))
                    .map((t) => ({ value: String(t.id), label: t.name }))}
                  value={picked.template} onChange={(v) => setPick('template', v)}
                />
              </Table.Th>
              <Table.Th>
                <Select
                  size="xs" placeholder="все" clearable
                  data={types.map((t) => ({ value: String(t.id), label: t.name }))}
                  value={picked.type} onChange={(v) => setPick('type', v)}
                />
              </Table.Th>
              <Table.Th>
                <TextInput
                  size="xs" placeholder="10.10." value={text.management_ip}
                  onChange={(e) => setField('management_ip', e.currentTarget.value)}
                />
              </Table.Th>
              <Table.Th>
                <TextInput
                  size="xs" placeholder="a4:bb…" value={text.mac}
                  onChange={(e) => setField('mac', e.currentTarget.value)}
                />
              </Table.Th>
              <Table.Th>
                <Select
                  size="xs" placeholder="все" clearable searchable
                  data={groups.map((g) => ({ value: String(g.id), label: g.name }))}
                  value={picked.group} onChange={(v) => setPick('group', v)}
                />
              </Table.Th>
              <Table.Th>
                <Select
                  size="xs" placeholder="все" clearable searchable
                  data={flattenTagsOrdered(tags).map(({ tag, depth }) => ({
                    value: String(tag.id), label: `${'—'.repeat(depth)} ${tag.name}`,
                  }))}
                  value={picked.tag} onChange={(v) => setPick('tag', v)}
                />
              </Table.Th>
              <Table.Th />
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {devices.map((d) => {
              const template = templates.find((t) => t.id === d.template_id);
              return (
                <DeviceRow
                  key={d.id}
                  device={d}
                  template={template}
                  typeName={typeNameForTemplate(template, types)}
                  groupName={groups.find((g) => g.id === d.topology_group_id)?.name ?? '—'}
                  vlans={vlans}
                  columns={COLUMNS}
                  onEdit={() => setEditing(d)}
                />
              );
            })}
            {devices.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={COLUMNS}>
                  <Text c="dimmed">{isLoading ? 'Загрузка…' : 'Нет устройств по выбранным условиям.'}</Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

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
      {addingTemplate && <TemplateFormModal template={null} onClose={() => setAddingTemplate(false)} />}
    </Stack>
  );
}
