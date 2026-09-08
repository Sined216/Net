import { useMemo, useState } from 'react';
import { Alert, Button, Group, Modal, Select, Stack, Table, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useFreePorts, useLinkTemplates, useMoveImportLinkRow } from '../../api/hooks';
import { notifyError, notifySuccess } from '../../lib/notify';
import { nnInt } from '../../lib/utils';
import type { ImportLinkRowOut } from '../../api/types';

/** Перенос строки обхода в настоящую связь.
 *
 * Строка приезжает из цеха текстом — «свитч у окна», «порт 3». Сервер уже
 * попытался узнать в этом заведённые устройство и гнездо и прислал догадки;
 * здесь они лишь подставлены в списки, а решает человек. Слева всегда
 * видно, что именно записали в цеху, — иначе сверять не с чем.
 *
 * Выбор идёт сразу парой «устройство + порт», а не двумя списками: связь
 * соединяет гнёзда, и свободные гнёзда сервер и так отдаёт вместе с их
 * железками. Занятые в список не попадают — порт участвует не более чем в
 * одной связи.
 */
export function MoveLinkRowModal({ row, onClose }: { row: ImportLinkRowOut; onClose: () => void }) {
  const { data: linkTemplates = [] } = useLinkTemplates();
  const move = useMoveImportLinkRow();

  // Догадка сервера — начальное значение. Если гнездо уже занято, оно в
  // список свободных не попадёт, и человек выберет другое: так и надо,
  // молча подставлять занятое нельзя.
  const [portA, setPortA] = useState<string | null>(
    row.suggested_a_interface_id != null && !row.a_interface_busy
      ? String(row.suggested_a_interface_id) : null,
  );
  const [portB, setPortB] = useState<string | null>(
    row.suggested_b_interface_id != null && !row.b_interface_busy
      ? String(row.suggested_b_interface_id) : null,
  );
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [searchA, setSearchA] = useState('');
  const [searchB, setSearchB] = useState('');

  const optionsA = usePortOptions(searchA, row.suggested_a_device_id);
  const optionsB = usePortOptions(searchB, row.suggested_b_device_id);

  const sameEnds = portA != null && portA === portB;
  const canSubmit = portA != null && portB != null && !sameEnds;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    move.mutate(
      {
        rowId: row.id,
        body: {
          interface_a_id: parseInt(portA, 10),
          interface_b_id: parseInt(portB, 10),
          template_id: nnInt(templateId),
          // Что записали в цеху, переносим в заметку связи: сама строка
          // обхода потом может быть убрана, а это — единственный след того,
          // откуда связь взялась и как её описал человек на месте.
          notes: [row.notes, row.medium && `среда: ${row.medium}`].filter(Boolean).join('\n') || null,
        },
      },
      { onSuccess: () => { notifySuccess('Связь заведена'); onClose(); }, onError: notifyError },
    );
  }

  return (
    <Modal opened onClose={onClose} title="Завести связь по записи обхода" size="lg">
      <form onSubmit={handleSubmit}>
        <Stack>
          <Table withTableBorder verticalSpacing={4} horizontalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={110}>Записано в цеху</Table.Th>
                <Table.Th>Конец A</Table.Th>
                <Table.Th>Конец B</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              <Table.Tr>
                <Table.Td><Text size="sm" c="dimmed">устройство</Text></Table.Td>
                <Table.Td><Text size="sm">{row.a_device_text || '—'}</Text></Table.Td>
                <Table.Td><Text size="sm">{row.b_device_text || '—'}</Text></Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td><Text size="sm" c="dimmed">гнездо</Text></Table.Td>
                <Table.Td><Text size="sm">{row.a_port_text || '—'}</Text></Table.Td>
                <Table.Td><Text size="sm">{row.b_port_text || '—'}</Text></Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>

          {(row.a_interface_busy || row.b_interface_busy) && (
            <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
              Гнездо, на которое метится запись, уже занято другой связью — в списке свободных его нет.
              Либо в цеху переткнули кабель (тогда сначала поправьте старую связь), либо запись про другое гнездо.
            </Alert>
          )}

          <Select
            label="Конец A — устройство и порт" required searchable
            placeholder="начните вводить код, название или модель"
            data={optionsA} value={portA} onChange={setPortA}
            searchValue={searchA} onSearchChange={setSearchA}
            nothingFoundMessage="Свободных портов не нашлось"
          />
          <Select
            label="Конец B — устройство и порт" required searchable
            placeholder="начните вводить код, название или модель"
            data={optionsB} value={portB} onChange={setPortB}
            searchValue={searchB} onSearchChange={setSearchB}
            nothingFoundMessage="Свободных портов не нашлось"
          />
          {sameEnds && (
            <Alert color="red" variant="light">Оба конца — одно и то же гнездо: связи из этого не выйдет.</Alert>
          )}

          {linkTemplates.length > 0 && (
            <Select
              label="Тип кабеля" clearable placeholder="не указан"
              data={linkTemplates.map((t) => ({ value: String(t.id), label: t.name }))}
              value={templateId} onChange={setTemplateId}
            />
          )}

          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Отмена</Button>
            <Button type="submit" loading={move.isPending} disabled={!canSubmit}>Завести связь</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** Свободные гнёзда для списка — ищет сервер, а не браузер.
 *
 * Пока человек ничего не набрал, показываем порты того устройства, которое
 * опознал сервер: в девяти случаях из десяти выбирать нужно именно там, и
 * искать заново незачем. Как только начал набирать — обычный поиск по всей
 * площадке.
 */
function usePortOptions(search: string, suggestedDeviceId: number | null | undefined) {
  const query = search.trim().length > 0
    ? { q: search.trim(), limit: 30 }
    : { device_id: suggestedDeviceId ?? undefined, limit: 30 };
  // Без опознанного устройства и без запроса искать нечего — не дёргаем сервер.
  const enabled = search.trim().length > 0 || suggestedDeviceId != null;
  const { data: ports = [] } = useFreePorts(query, enabled);

  return useMemo(
    () => ports.map((p) => ({
      value: String(p.interface_id),
      label: `${p.device_code}${p.device_name ? ` (${p.device_name})` : ''} — ${p.label}`,
    })),
    [ports],
  );
}
