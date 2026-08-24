import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDebouncedValue } from '@mantine/hooks';
import { Loader, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import * as api from '../api/endpoints';

/** Поиск по устройству (имя, код, свой IP или MAC) и по порту (IP или MAC
 * гнезда). Строка без порта — совпадение по самому устройству; строку с
 * портом искали именно за него, и показывать какой-то один порт, если
 * совпало устройство целиком, было бы обманом (см. `SearchResult` на
 * бэкенде).
 *
 * Строка ведёт на страницу устройства — нашёл, и незачем после этого ещё
 * искать его вручную в списке. */
export function SearchPage() {
  const [query, setQuery] = useState('');
  const [debounced] = useDebouncedValue(query, 300);
  const navigate = useNavigate();

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
      <Table withTableBorder verticalSpacing="xs" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Устройство</Table.Th>
            <Table.Th>Порт</Table.Th>
            <Table.Th>IP</Table.Th>
            <Table.Th>MAC</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {results.map((r, index) => (
            <Table.Tr
              // Найденное устройство целиком не привязано ни к одному
              // порту — id порта тогда не годится в ключ строки, у двух
              // разных совпадений устройства его вовсе нет.
              key={r.interface_id ?? `device-${r.device_id}-${index}`}
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/devices/${r.device_id}`)}
            >
              <Table.Td>
                {r.device_code}
                {r.device_name ? ` — ${r.device_name}` : ''}
              </Table.Td>
              <Table.Td>
                {r.interface_label ?? <Text span c="dimmed">—</Text>}
              </Table.Td>
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
