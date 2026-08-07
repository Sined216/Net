import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDebouncedValue } from '@mantine/hooks';
import { Loader, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import * as api from '../api/endpoints';

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [debounced] = useDebouncedValue(query, 300);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.search(debounced),
    enabled: debounced.trim().length > 0,
  });

  return (
    <Stack>
      <Title order={2}>Поиск по IP / MAC / имени</Title>
      <TextInput
        placeholder="Например: 10.10.20.15 или SW-0001"
        leftSection={<IconSearch size={16} />}
        rightSection={isFetching ? <Loader size={14} /> : null}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />
      <Table withTableBorder verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Устройство</Table.Th>
            <Table.Th>Порт</Table.Th>
            <Table.Th>IP</Table.Th>
            <Table.Th>MAC</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {results.map((r) => (
            <Table.Tr key={r.interface_id}>
              <Table.Td>
                {r.device_code}
                {r.device_name ? ` — ${r.device_name}` : ''}
              </Table.Td>
              <Table.Td>{r.interface_label}</Table.Td>
              <Table.Td>{r.ip || '—'}</Table.Td>
              <Table.Td>{r.mac || '—'}</Table.Td>
            </Table.Tr>
          ))}
          {debounced.trim() && !isFetching && results.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={4}>
                <Text c="dimmed">Ничего не найдено</Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
