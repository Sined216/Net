import { useState } from 'react';
import { ActionIcon, Badge, Group, Menu, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconDotsVertical, IconPlugConnected } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { DeleteAction, RowAction } from '../../components/RowAction';
import {
  useClearImportLinkRows, useDeleteImportLinkRow, useImportLinkRows,
} from '../../api/hooks';
import { notifyError, notifySuccess } from '../../lib/notify';
import { confirmAction } from '../../lib/confirm';
import { MoveLinkRowModal } from './MoveLinkRowModal';
import { useCan } from '../../auth/permissions';
import type { ImportLinkRowOut } from '../../api/types';

/** Связи, привезённые из обхода с телефоном.
 *
 * Устройства из обхода разбираются на соседней вкладке — тем же механизмом,
 * что и строки из файла. Кабелям своей таблицы до сих пор не было: в файле
 * их и не бывает (кабель соединяет порты, а портов до заведения устройства
 * ещё нет), а вот из цеха они приезжают.
 *
 * Строка приходит текстом — «свитч у окна», «порт 3». Сервер пытается
 * узнать в этом заведённые устройство и гнездо; что удалось, показано
 * рядом, а решает человек при переносе.
 */
export function LinkRowsPanel() {
  const { data: rows = [], isLoading } = useImportLinkRows();
  const deleteRow = useDeleteImportLinkRow();
  const clearRows = useClearImportLinkRows();
  const [moving, setMoving] = useState<ImportLinkRowOut | null>(null);
  const canEdit = useCan('edit');

  const waiting = rows.filter((r) => r.status === 'new');
  const moved = rows.filter((r) => r.status === 'moved');

  if (rows.length === 0) {
    return (
      <Text c="dimmed" mt="md">
        {isLoading
          ? 'Загрузка…'
          : 'Пусто. Сюда попадают связи, отмеченные в цеху мобильным приложением: оно уносит снимок площадки '
            + 'в оффлайн, а привезённое обратно ложится в эту таблицу — не сразу в спецификацию.'}
      </Text>
    );
  }

  return (
    <Stack mt="md">
      <Group justify="space-between">
        <Group gap="xs">
          <Badge variant="light" color="blue">ждут переноса: {waiting.length}</Badge>
          <Badge variant="light" color="teal">перенесены: {moved.length}</Badge>
        </Group>
        {canEdit && (
          <Menu>
            <Menu.Target>
              <ActionIcon variant="default" size="lg" aria-label="Действия со строками обхода">
                <IconDotsVertical size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                disabled={moved.length === 0}
                onClick={() => clearRows.mutate('moved', {
                  onSuccess: () => notifySuccess('Разобранные записи убраны'), onError: notifyError,
                })}
              >
                Убрать разобранные ({moved.length})
              </Menu.Item>
              <Menu.Item
                color="red"
                onClick={async () => {
                  if (!(await confirmAction(
                    'Очистить записи обхода целиком? Заведённые по ним связи останутся.',
                  ))) return;
                  clearRows.mutate(undefined, {
                    onSuccess: () => notifySuccess('Записи обхода очищены'), onError: notifyError,
                  });
                }}
              >
                Очистить всё
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>

      <Table withTableBorder verticalSpacing="xs" horizontalSpacing="sm" striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Конец A — как записано</Table.Th>
            <Table.Th>Опознано</Table.Th>
            <Table.Th>Конец B — как записано</Table.Th>
            <Table.Th>Опознано</Table.Th>
            <Table.Th>Ещё из обхода</Table.Th>
            <Table.Th w={190}>Состояние</Table.Th>
            <Table.Th w={90} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row) => (
            <Table.Tr key={row.id}>
              <AsRecorded device={row.a_device_text} port={row.a_port_text} />
              <Resolved
                code={row.suggested_a_device_code}
                label={row.suggested_a_interface_label}
                deviceId={row.suggested_a_device_id}
                busy={row.status === 'new' && row.a_interface_busy}
              />
              <AsRecorded device={row.b_device_text} port={row.b_port_text} />
              <Resolved
                code={row.suggested_b_device_code}
                label={row.suggested_b_interface_label}
                deviceId={row.suggested_b_device_id}
                busy={row.status === 'new' && row.b_interface_busy}
              />
              <Table.Td>
                <Text size="xs" c="dimmed" lineClamp={2}>
                  {[row.medium && `среда: ${row.medium}`, row.notes].filter(Boolean).join('; ') || '—'}
                </Text>
              </Table.Td>
              <Table.Td>
                {row.status === 'moved' ? (
                  <Group gap={6} wrap="nowrap">
                    <Badge size="sm" color="teal" variant="light" style={{ flexShrink: 0 }}>перенесена</Badge>
                    {row.link_id && (
                      <Text size="xs" component={Link} to="/links" c="blue">к связям</Text>
                    )}
                  </Group>
                ) : (
                  <Badge size="sm" variant="light">ждёт</Badge>
                )}
              </Table.Td>
              <Table.Td>
                {canEdit && (
                  <Group gap={2} justify="flex-end" wrap="nowrap">
                    {row.status === 'new' && (
                      <RowAction
                        label="Завести связь по этой записи"
                        icon={<IconPlugConnected size={16} />}
                        onClick={() => setMoving(row)}
                      />
                    )}
                    <DeleteAction
                      label="Убрать запись обхода"
                      onClick={async () => {
                        if (!(await confirmAction(
                          'Убрать запись обхода? Заведённую по ней связь это не тронет, но саму запись'
                          + ' придётся привозить из цеха заново.',
                        ))) return;
                        deleteRow.mutate(row.id, { onError: notifyError });
                      }}
                    />
                  </Group>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      {moving && <MoveLinkRowModal row={moving} onClose={() => setMoving(null)} />}
    </Stack>
  );
}

/** Что записал человек в цеху — как есть, без приукрашивания. */
function AsRecorded({ device, port }: { device?: string | null; port?: string | null }) {
  if (!device && !port) return <Table.Td><Text c="dimmed" size="sm">—</Text></Table.Td>;
  return (
    <Table.Td>
      <Text size="sm">{device || <Text span c="dimmed">без устройства</Text>}</Text>
      {port && <Text size="xs" c="dimmed">гнездо: {port}</Text>}
    </Table.Td>
  );
}

/** Что из записанного удалось узнать в спецификации.
 *
 * Пусто — не беда: устройство выберут руками при переносе. «Занято» — не
 * запрет, а предупреждение: в цеху могли переткнуть кабель, и тогда сначала
 * правят старую связь. У уже перенесённой строки этой пометки нет: гнёзда
 * занял как раз её перенос, и предупреждать тут не о чем.
 */
function Resolved({ code, label, deviceId, busy }: {
  code?: string | null;
  label?: string | null;
  deviceId?: number | null;
  busy?: boolean;
}) {
  if (!code) {
    return (
      <Table.Td>
        <Tooltip label="В спецификации такого устройства не нашлось — выберите вручную при переносе">
          <Badge size="xs" color="orange" variant="light">не опознано</Badge>
        </Tooltip>
      </Table.Td>
    );
  }
  return (
    <Table.Td bg={busy ? 'var(--mantine-color-yellow-light)' : 'var(--mantine-color-green-light)'}>
      <Text size="sm" component={Link} to={`/devices/${deviceId}`} c={busy ? 'yellow.9' : 'green.9'}>
        {code}
      </Text>
      {label && <Text size="xs" c="dimmed">{label}</Text>}
      {busy && (
        <Tooltip label="Это гнездо уже занято другой связью">
          <Badge size="xs" color="yellow" variant="light">занято</Badge>
        </Tooltip>
      )}
    </Table.Td>
  );
}
