import { useMemo, useRef, useState } from 'react';
import {
  ActionIcon, Alert, Badge, Button, Group, Menu, Stack, Table, Text, Title, Tooltip, UnstyledButton,
} from '@mantine/core';
import {
  IconArrowsSort, IconChevronDown, IconChevronUp, IconDotsVertical, IconPlus, IconTrash, IconUpload,
} from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import {
  useClearImportRows, useDeleteImportRow, useDeviceTemplates, useImportRows, useUploadImportFile,
} from '../api/hooks';
import { notifyError, notifySuccess } from '../lib/notify';
import { DeviceFormModal } from './devices/DeviceFormModal';
import { MissingRefs } from './import/MissingRefs';
import type { ImportRowOut } from '../api/types';
import { useCan } from '../auth/permissions';

/** Импорт устройств из файла.
 *
 * Файл не заводит устройства сам: строки ложатся в промежуточную таблицу, а
 * человек переносит их по одной — кнопкой «Добавить», которая открывает
 * обычное окно устройства с уже подставленными данными. В файле бывают
 * опечатки и наполовину пустые строки, и превращать их в записи
 * спецификации без разбора нельзя.
 */
export function ImportPage() {
  const { data: rows = [], isLoading } = useImportRows();
  const { data: templates = [] } = useDeviceTemplates();
  const upload = useUploadImportFile();
  const deleteRow = useDeleteImportRow();
  const clearRows = useClearImportRows();
  const fileInput = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState<ImportRowOut | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'row_number', desc: false });
  const canEdit = useCan('edit');

  const waiting = rows.filter((r) => r.status === 'new');
  const moved = rows.filter((r) => r.status === 'moved');
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);

  /** Щелчок по заголовку: первый раз — по возрастанию, второй — наоборот. */
  function toggleSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, desc: !prev.desc } : { key, desc: false }));
  }

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';  // тот же файл можно выбрать повторно
    if (!file) return;
    upload.mutate(file, {
      onSuccess: (summary) => notifySuccess(`Из файла «${summary.file}» прочитано строк: ${summary.added}`),
      onError: notifyError,
    });
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Импорт устройств</Title>
        <Group>
          {canEdit && rows.length > 0 && (
            <Menu>
              <Menu.Target>
                <ActionIcon variant="default" size="lg"><IconDotsVertical size={16} /></ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  disabled={moved.length === 0}
                  onClick={() => clearRows.mutate('moved', {
                    onSuccess: () => notifySuccess('Разобранные строки убраны'), onError: notifyError,
                  })}
                >
                  Убрать разобранные ({moved.length})
                </Menu.Item>
                <Menu.Item
                  color="red"
                  onClick={() => {
                    if (!confirm('Очистить таблицу импорта целиком? Заведённые устройства останутся.')) return;
                    clearRows.mutate(undefined, {
                      onSuccess: () => notifySuccess('Таблица импорта очищена'), onError: notifyError,
                    });
                  }}
                >
                  Очистить всё
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
          {canEdit && (
            <Button
              leftSection={<IconUpload size={16} />} loading={upload.isPending}
              onClick={() => fileInput.current?.click()}
            >
              Загрузить файл
            </Button>
          )}
        </Group>
      </Group>
      <input
        ref={fileInput} type="file" accept=".csv,.xlsx,.xlsm,.txt,.xml" hidden onChange={handleFile}
      />

      <Text c="dimmed" size="sm">
        Строки из файла попадают сюда, а не сразу в спецификацию оборудования. «Добавить» открывает обычное окно
        устройства с тем, что удалось разобрать: шаблон, IP, группа. Чего в файле нет — заполняется руками.
        Связи из файла не заводятся: кабель соединяет порты, а портов до заведения устройства ещё нет.
        Зелёным подсвечены название и адрес, которые в спецификации уже есть, — такую строку, скорее всего,
        переносить не нужно. Кроме таблиц принимается выгрузка Siemens Automation Tool (.xml): из неё
        читаются станции с их адресами, моделями, артикулами и составом стоек.
      </Text>

      {templates.length === 0 && (
        <Alert color="yellow" variant="light">
          Шаблонов устройств пока нет — завести устройство будет не из чего. Начните с вкладки «Шаблоны»:
          шаблон задаёт состав портов.
        </Alert>
      )}

      {canEdit && <MissingRefs rows={rows} />}

      {rows.length === 0 ? (
        <Text c="dimmed">
          {isLoading
            ? 'Загрузка…'
            : 'Пусто. Загрузите .xlsx или .csv — колонки распознаются по названиям: имя, шаблон (модель), IP, '
              + 'группа, теги. Остальные попадут в «Ещё из файла» — они не пропадут, но полем устройства не станут. '
              + 'Либо .xml — выгрузку Siemens Automation Tool, её структура известна заранее.'}
        </Text>
      ) : (
        <>
          <Group gap="xs">
            <Badge variant="light" color="blue">ждут переноса: {waiting.length}</Badge>
            <Badge variant="light" color="teal">перенесены: {moved.length}</Badge>
          </Group>
          <Table withTableBorder verticalSpacing="xs" horizontalSpacing="sm" striped>
            <Table.Thead>
              <Table.Tr>
                <SortTh w={70} field="row_number" sort={sort} onSort={toggleSort}>Строка</SortTh>
                <SortTh field="name" sort={sort} onSort={toggleSort}>Название</SortTh>
                <SortTh field="template_name" sort={sort} onSort={toggleSort}>Шаблон устройства</SortTh>
                <SortTh w={130} field="management_ip" sort={sort} onSort={toggleSort}>IP</SortTh>
                <SortTh field="group_name" sort={sort} onSort={toggleSort}>Группа и теги</SortTh>
                <Table.Th>Ещё из файла</Table.Th>
                <SortTh w={160} field="status" sort={sort} onSort={toggleSort}>Состояние</SortTh>
                <Table.Th w={90} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sorted.map((row) => (
                <Table.Tr key={row.id}>
                  <Table.Td>
                    <Tooltip label={row.source_file}>
                      <Text size="sm" c="dimmed">№{row.row_number}</Text>
                    </Tooltip>
                  </Table.Td>
                  <SameAsExisting value={row.name} deviceId={row.same_name_device_id} what="названием" />
                  <Table.Td>
                    {row.template_name ? (
                      <Group gap={6} wrap="nowrap">
                        <Text size="sm">{row.template_name}</Text>
                        {row.suggested_template_id == null && (
                          <Badge size="xs" color="orange" variant="light" style={{ flexShrink: 0 }}>
                            нет в базе
                          </Badge>
                        )}
                      </Group>
                    ) : <Text c="dimmed" size="sm">—</Text>}
                  </Table.Td>
                  <SameAsExisting value={row.management_ip} deviceId={row.same_ip_device_id} what="адресом" />
                  <Table.Td>
                    {row.group_name && (
                      <Group gap={6} wrap="nowrap">
                        <Text size="sm">{row.group_name}</Text>
                        {row.suggested_group_id == null && (
                          <Badge size="xs" color="orange" variant="light" style={{ flexShrink: 0 }}>
                            нет в базе
                          </Badge>
                        )}
                      </Group>
                    )}
                    {row.tags_text && <Text size="xs" c="dimmed">теги: {row.tags_text}</Text>}
                    {!row.group_name && !row.tags_text && <Text c="dimmed" size="sm">—</Text>}
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed" lineClamp={2}>
                      {row.extra ? Object.entries(row.extra).map(([k, v]) => `${k}: ${v}`).join('; ') : '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {row.status === 'moved' ? (
                      <Group gap={6} wrap="nowrap">
                        <Badge size="sm" color="teal" variant="light">перенесена</Badge>
                        {row.device_id && (
                          <Text size="xs" component={Link} to={`/devices/${row.device_id}`} c="blue">
                            открыть
                          </Text>
                        )}
                      </Group>
                    ) : (
                      <Badge size="sm" variant="light">ждёт</Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={2} justify="flex-end" wrap="nowrap" display={canEdit ? undefined : 'none'}>
                      {row.status === 'new' && (
                        <Tooltip label="Завести устройство по этой строке">
                          <ActionIcon variant="subtle" size="sm" onClick={() => setAdding(row)}>
                            <IconPlus size={16} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      <Tooltip label="Убрать строку из импорта">
                        <ActionIcon
                          variant="subtle" size="sm" color="red"
                          onClick={() => deleteRow.mutate(row.id, { onError: notifyError })}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </>
      )}

      {adding && (
        <DeviceFormModal
          device={null}
          importRowId={adding.id}
          draft={{
            template_id: adding.suggested_template_id,
            name: adding.name,
            management_ip: adding.management_ip,
            notes: [adding.notes, extraAsNote(adding)].filter(Boolean).join('\n') || null,
            topology_group_id: adding.suggested_group_id,
            tag_ids: adding.suggested_tag_ids,
          }}
          onClose={() => setAdding(null)}
        />
      )}
    </Stack>
  );
}

/** По каким колонкам таблица упорядочивается. «Ещё из файла» здесь нет: это
 * мешанина неразобранных колонок, и порядок по ней ничего не значит. */
type SortKey = 'row_number' | 'name' | 'template_name' | 'management_ip'
  | 'group_name' | 'status';

/** Заголовок, по которому упорядочивают.
 *
 * Порядок считает браузер, а не сервер: таблица импорта — это разобранный
 * файл, живущий до переноса строк, и целиком он и так уже здесь. Гонять его
 * на сервер ради `ORDER BY` значило бы ждать ответа там, где сортировка
 * мгновенна.
 */
function SortTh({ field, sort, onSort, w, children }: {
  field: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (key: SortKey) => void;
  w?: number;
  children: React.ReactNode;
}) {
  const active = sort.key === field;
  const Icon = active ? (sort.desc ? IconChevronDown : IconChevronUp) : IconArrowsSort;
  return (
    <Table.Th w={w}>
      <UnstyledButton onClick={() => onSort(field)} style={{ width: '100%' }}>
        <Group gap={4} wrap="nowrap">
          <Text size="sm" fw={600}>{children}</Text>
          <Icon size={13} opacity={active ? 0.9 : 0.35} style={{ flexShrink: 0 }} />
        </Group>
      </UnstyledButton>
    </Table.Th>
  );
}

/** Порядок строк.
 *
 * Пустые значения всегда внизу, в любую сторону: строка без названия — это
 * то, что предстоит дозаполнить руками, и ей незачем оказываться первой
 * только потому, что порядок развернули.
 */
function sortRows(rows: ImportRowOut[], sort: { key: SortKey; desc: boolean }): ImportRowOut[] {
  const direction = sort.desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const left = a[sort.key];
    const right = b[sort.key];
    const emptyLeft = left == null || left === '';
    const emptyRight = right == null || right === '';
    if (emptyLeft || emptyRight) return emptyLeft && emptyRight ? a.row_number - b.row_number : (emptyLeft ? 1 : -1);
    const compared = typeof left === 'number' && typeof right === 'number'
      ? left - right
      // Числа внутри текста сравниваются как числа: иначе «Цех 10» встаёт
      // между «Цех 1» и «Цех 2».
      : String(left).localeCompare(String(right), 'ru', { numeric: true });
    // Одинаковые значения — по номеру строки в файле: иначе при каждом
    // пересчёте они меняются местами.
    return compared * direction || a.row_number - b.row_number;
  });
}

/** Ячейка, которая подсвечивается, если такое же значение в спецификации
 * уже есть.
 *
 * Файлы приносят повторно — с доливкой пары строк или после правки, — и без
 * пометки человек заводит второе такое же устройство. Это не запрет: тёзки
 * бывают и настоящие, поэтому строка остаётся переносимой, а зелёный лишь
 * говорит «посмотри, это уже заведено» и ведёт на найденное устройство.
 */
function SameAsExisting({ value, deviceId, what }: {
  value: string | null | undefined;
  deviceId: number | null | undefined;
  what: string;
}) {
  if (!value) return <Table.Td><Text c="dimmed" size="sm">—</Text></Table.Td>;
  if (deviceId == null) return <Table.Td><Text size="sm">{value}</Text></Table.Td>;
  return (
    <Table.Td bg="var(--mantine-color-green-light)">
      <Tooltip label={`Устройство с таким ${what} уже заведено — открыть`}>
        <Text size="sm" component={Link} to={`/devices/${deviceId}`} c="green.9">{value}</Text>
      </Tooltip>
    </Table.Td>
  );
}

/** Колонки файла, которым не нашлось поля, уходят в заметку: выбросить их
 * нельзя — по инвентарному номеру человек и опознаёт железку. */
function extraAsNote(row: ImportRowOut): string {
  if (!row.extra) return '';
  return Object.entries(row.extra).map(([key, value]) => `${key}: ${value}`).join('\n');
}
