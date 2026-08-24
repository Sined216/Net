import { useState } from 'react';
import {
  Alert, Badge, Button, Group, Select, Stack, Table, Text, Title,
} from '@mantine/core';
import { useAudit, useUsers } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { AuditChanges, actionColor, actionLabel, formatMoment } from '../history/AuditEntry';

const PAGE = 50;

/** Кто и что менял.
 *
 * Доступна всем ролям, включая смотрящих: вопрос «кто переставил станок в
 * другой цех» обычно возникает как раз у того, кто сам править не может.
 *
 * Записи площадки видны на своей площадке; правки общих справочников —
 * моделей техники, разъёмов, пресетов кабелей — видны везде, потому что и
 * сами справочники общие.
 */
export function HistoryPage() {
  const { user } = useAuth();
  const [entityType, setEntityType] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  // Список людей доступен только администратору — остальным фильтр по автору
  // просто не показываем, вместо того чтобы ловить 403.
  const { data: users = [] } = useUsers(user?.role === 'admin');

  const query = {
    entity_type: entityType ?? undefined,
    user_id: userId ? parseInt(userId, 10) : undefined,
    limit: PAGE,
    offset: page * PAGE,
  };
  const { data, isLoading, error } = useAudit(query);
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <Stack>
      <Title order={2}>История изменений</Title>
      <Text c="dimmed" size="sm">
        Записывается всё, что меняет документацию: оборудование, кабели, справочники, учётные записи.
        Перетаскивание узлов по схеме не записывается — это оформление, а не данные.
      </Text>

      <Group>
        <Select
          placeholder="Что менялось" clearable w={220} value={entityType}
          onChange={(value) => { setEntityType(value); setPage(0); }}
          data={[
            { value: 'device', label: 'Устройства' },
            { value: 'interface', label: 'Порты' },
            { value: 'link', label: 'Кабели' },
            { value: 'device_template', label: 'Модели техники' },
            { value: 'device_type', label: 'Типы устройств' },
            { value: 'link_template', label: 'Шаблоны связей' },
            { value: 'connector_type', label: 'Разъёмы' },
            { value: 'transceiver_module', label: 'Модули' },
            { value: 'tag', label: 'Теги' },
            { value: 'vlan', label: 'VLAN' },
            { value: 'topology_group', label: 'Группы топологии' },
            { value: 'site', label: 'Площадки' },
            { value: 'user', label: 'Пользователи' },
          ]}
        />
        {user?.role === 'admin' && (
          <Select
            placeholder="Кто менял" clearable w={220} value={userId}
            onChange={(value) => { setUserId(value); setPage(0); }}
            data={users.map((u) => ({ value: String(u.id), label: u.full_name }))}
          />
        )}
        <Text size="sm" c="dimmed">Записей: {total}</Text>
      </Group>

      {error && <Alert color="red">{(error as Error).message}</Alert>}

      <Table.ScrollContainer minWidth={800}>
        <Table withTableBorder verticalSpacing="xs" horizontalSpacing="sm" striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={150}>Когда</Table.Th>
              <Table.Th w={110}>Действие</Table.Th>
              <Table.Th w={190}>Что</Table.Th>
              <Table.Th w={170}>Кто</Table.Th>
              <Table.Th>Изменения</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((entry) => (
              <Table.Tr key={entry.id}>
                <Table.Td><Text size="xs" c="dimmed">{formatMoment(entry.created_at)}</Text></Table.Td>
                <Table.Td>
                  <Badge size="sm" variant="light" color={actionColor(entry.action)}>
                    {actionLabel(entry.action)}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">
                    {entry.entity_label}
                    {entry.entity_id != null && <Text span c="dimmed"> #{entry.entity_id}</Text>}
                  </Text>
                </Table.Td>
                <Table.Td><Text size="sm">{entry.user_name ?? '—'}</Text></Table.Td>
                <Table.Td><AuditChanges entry={entry} /></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {items.length === 0 && (
        <Text c="dimmed">{isLoading ? 'Загрузка…' : 'Записей нет'}</Text>
      )}

      {total > PAGE && (
        <Group justify="center">
          <Button variant="default" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Назад
          </Button>
          <Text size="sm" c="dimmed">
            {page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} из {total}
          </Text>
          <Button
            variant="default" disabled={(page + 1) * PAGE >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            Дальше
          </Button>
        </Group>
      )}
    </Stack>
  );
}
