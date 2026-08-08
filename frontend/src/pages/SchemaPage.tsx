import { Badge, Card, Group, Stack, Table, Text, Title } from '@mantine/core';
import { IconKey, IconLink } from '@tabler/icons-react';
import { useDatabaseSchema } from '../api/hooks';

/** Структура базы — как она есть на самом деле.
 *
 * Данные читаются интроспекцией живой базы, а не из описания схемы в
 * репозитории: показывать нужно то, что реально лежит на диске. Расхождение
 * моделей с `schema.sql` уже случалось, и заметить его по документу было
 * нельзя. */
export function SchemaPage() {
  const { data, isLoading, error } = useDatabaseSchema();

  if (isLoading) return <Text c="dimmed">Загрузка…</Text>;
  if (error) return <Text c="red">{(error as Error).message}</Text>;

  const tables = data?.tables ?? [];

  return (
    <Stack>
      <Title order={2}>Структура базы данных</Title>
      <Text c="dimmed" size="sm">
        Читается прямо из работающей базы: типы, ограничения и число строк — фактические, а не из
        описания в репозитории. Таблиц: {tables.length}.
      </Text>

      {tables.map((table) => (
        <Card key={table.name} withBorder padding="sm">
          <Group justify="space-between" wrap="nowrap" mb={table.note ? 2 : 'xs'}>
            <Text fw={700} ff="monospace">{table.name}</Text>
            <Badge variant="light" color="gray">{table.row_count} строк</Badge>
          </Group>
          {table.note && <Text size="sm" c="dimmed" mb="xs">{table.note}</Text>}

          <Table verticalSpacing={2} horizontalSpacing="sm" withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w="26%">Колонка</Table.Th>
                <Table.Th w="24%">Тип</Table.Th>
                <Table.Th w="14%">Обязательна</Table.Th>
                <Table.Th>Ключи и ссылки</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {table.columns.map((column) => (
                <Table.Tr key={column.name}>
                  <Table.Td>
                    <Text size="sm" ff="monospace" fw={column.primary_key ? 700 : 400}>
                      {column.name}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed" ff="monospace">{column.type}</Text>
                  </Table.Td>
                  <Table.Td>
                    {column.nullable
                      ? <Text size="sm" c="dimmed">нет</Text>
                      : <Text size="sm">да</Text>}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="wrap">
                      {column.primary_key && (
                        <Badge size="sm" variant="light" color="yellow" leftSection={<IconKey size={11} />}>
                          первичный ключ
                        </Badge>
                      )}
                      {column.unique && !column.primary_key && (
                        <Badge size="sm" variant="light" color="grape">уникальна</Badge>
                      )}
                      {column.references && (
                        <Badge size="sm" variant="light" color="blue" leftSection={<IconLink size={11} />}>
                          {column.references}
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      ))}
    </Stack>
  );
}
