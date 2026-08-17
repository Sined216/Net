import { useState } from 'react';
import {
  Badge, Collapse, Group, Input, Popover, ScrollArea, Text, TextInput, UnstyledButton,
} from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconSearch } from '@tabler/icons-react';
import type { DeviceTemplateOut, DeviceTypeOut } from '../../api/types';

/** Выбор шаблона устройства: список категорий, свёрнутых по умолчанию, —
 * раскрываются по нажатию, как на вкладке «Шаблоны». Плоский список без
 * этого на полусотне моделей читался целиком в поисках нужной; раскрытые
 * сразу все категории заняли бы столько же места, только с заголовками.
 *
 * Внутри категории — производитель раньше названия: у завода техника
 * стоит партиями одной марки, и увидеть сразу всё «Cisco» рядом важнее,
 * чем угадывать модель по алфавиту без подсказки, кто её выпустил.
 */
export function TemplatePicker({
  templates, deviceTypes, value, onChange, disabled, required, label, placeholder,
}: {
  templates: DeviceTemplateOut[];
  deviceTypes: DeviceTypeOut[];
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  required?: boolean;
  label?: string;
  placeholder?: string;
}) {
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState('');
  // Свёрнутые/развёрнутые категории — по нажатию, отдельно от поиска: ввод
  // текста ищет по всем моделям сразу, а раскрытые вручную категории при
  // этом не трогает — стоило очистить поле, и список возвращается к тому,
  // что человек уже открыл сам.
  const [openTypes, setOpenTypes] = useState<Set<number | null>>(new Set());

  const selected = templates.find((t) => String(t.id) === value) ?? null;

  const groups = groupByType(templates, deviceTypes);
  const query = search.trim().toLowerCase();
  const flatMatches = query
    ? sortByManufacturer(templates.filter((t) => matches(t, query)))
    : null;

  function pick(id: number) {
    onChange(String(id));
    setOpened(false);
    setSearch('');
  }

  function toggleType(id: number | null) {
    setOpenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <Popover
      opened={opened} onChange={setOpened} width="target" position="bottom-start"
      shadow="md" trapFocus={false}
    >
      <Popover.Target>
        <Input.Wrapper label={label} required={required}>
          <Input
            component="button" type="button" disabled={disabled}
            onClick={() => setOpened((o) => !o)}
            rightSection={<IconChevronDown size={16} />}
            style={{ textAlign: 'left' }}
          >
            {selected ? itemLabel(selected) : (
              <Text component="span" c="dimmed">{placeholder ?? '— выбрать —'}</Text>
            )}
          </Input>
        </Input.Wrapper>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        <TextInput
          placeholder="Найти модель или производителя..." value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          leftSection={<IconSearch size={14} />} size="sm" mb="xs"
          data-autofocus
        />
        <ScrollArea.Autosize mah={320}>
          {flatMatches ? (
            flatMatches.length === 0 ? (
              <Text size="sm" c="dimmed" py="xs">Ничего не найдено</Text>
            ) : flatMatches.map((t) => (
              <TemplateRow key={t.id} template={t} onPick={pick} />
            ))
          ) : (
            groups.map(({ type, list }) => (
              <div key={type?.id ?? -1}>
                <UnstyledButton onClick={() => toggleType(type?.id ?? null)} style={{ width: '100%' }}>
                  <Group gap={6} py={4} wrap="nowrap">
                    {openTypes.has(type?.id ?? null)
                      ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                    <Text size="sm" fw={600}>{type?.name ?? 'Без категории'}</Text>
                    <Badge size="xs" variant="light" color="gray">{list.length}</Badge>
                  </Group>
                </UnstyledButton>
                <Collapse expanded={openTypes.has(type?.id ?? null)}>
                  <div style={{ paddingLeft: 20 }}>
                    {list.map((t) => <TemplateRow key={t.id} template={t} onPick={pick} />)}
                  </div>
                </Collapse>
              </div>
            ))
          )}
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
}

function TemplateRow({ template, onPick }: { template: DeviceTemplateOut; onPick: (id: number) => void }) {
  return (
    <UnstyledButton onClick={() => onPick(template.id)} style={{ width: '100%' }} py={4}>
      <Text size="sm">{itemLabel(template)}</Text>
    </UnstyledButton>
  );
}

/** Подпись модели: производитель впереди названия — так же, как список и
 * сортирован, — а число портов в конце, как раньше. */
function itemLabel(t: DeviceTemplateOut): string {
  const name = t.manufacturer ? `${t.manufacturer} — ${t.name}` : t.name;
  return `${name} (${t.interfaces.length} порт.)`;
}

function matches(t: DeviceTemplateOut, query: string): boolean {
  return t.name.toLowerCase().includes(query) || (t.manufacturer ?? '').toLowerCase().includes(query);
}

/** Производитель — первый ключ сортировки, название — второй. Модели без
 * производителя идут в конце, а не в начале: пустая строка иначе оказалась
 * бы «раньше» любой буквы. */
function sortByManufacturer(list: DeviceTemplateOut[]): DeviceTemplateOut[] {
  return [...list].sort((a, b) => {
    const ma = a.manufacturer ?? '';
    const mb = b.manufacturer ?? '';
    if (ma !== mb) {
      if (!ma) return 1;
      if (!mb) return -1;
      return ma.localeCompare(mb, 'ru');
    }
    return a.name.localeCompare(b.name, 'ru');
  });
}

function groupByType(templates: DeviceTemplateOut[], deviceTypes: DeviceTypeOut[]) {
  const byType = new Map<number, DeviceTemplateOut[]>();
  const noType: DeviceTemplateOut[] = [];
  for (const t of templates) {
    const type = deviceTypes.find((dt) => dt.id === t.device_type_id);
    if (!type) { noType.push(t); continue; }
    if (!byType.has(type.id)) byType.set(type.id, []);
    byType.get(type.id)!.push(t);
  }
  const groups: { type: DeviceTypeOut | undefined; list: DeviceTemplateOut[] }[] = [...byType.entries()]
    .map(([typeId, list]) => ({
      type: deviceTypes.find((dt) => dt.id === typeId)!,
      list: sortByManufacturer(list),
    }))
    .sort((a, b) => a.type!.name.localeCompare(b.type!.name, 'ru'));
  if (noType.length) groups.push({ type: undefined, list: sortByManufacturer(noType) });
  return groups;
}
