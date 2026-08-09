import { useMemo } from 'react';
import {
  ActionIcon, Anchor, Badge, Button, Card, Group, NumberInput, Paper, Stack, Table, Text, Title,
} from '@mantine/core';
import { IconArrowLeft, IconPlus, IconTopologyStar, IconTrash } from '@tabler/icons-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  useAddInterface, useAddInterfacesBulk, useDeleteDevice, useDeviceTemplates, useDeviceTypes, useDevices, useVlans,
} from '../api/hooks';
import { notifyError, notifySuccess } from '../lib/notify';
import { InterfaceRow, type FreeEntry } from './devices/InterfaceRow';
import { useState } from 'react';

const EMPTY: never[] = [];

/** Отдельная страница устройства — на неё можно дать ссылку.
 *
 * Раньше всё жило в одном списке с раскрывающимися карточками: показать
 * коллеге конкретный коммутатор можно было только словами «пролистай до
 * SW-0007». */
export function DevicePage() {
  const { deviceId } = useParams();
  const navigate = useNavigate();
  const { data: devices = EMPTY, isLoading } = useDevices();
  const { data: templates = EMPTY } = useDeviceTemplates();
  const { data: types = EMPTY } = useDeviceTypes();
  const { data: vlans = EMPTY } = useVlans();
  const addInterface = useAddInterface();
  const addPortsBulk = useAddInterfacesBulk();
  const deleteDevice = useDeleteDevice();
  const [bulkCount, setBulkCount] = useState<number | ''>(24);

  const id = Number(deviceId);
  const device = devices.find((d) => d.id === id);
  const template = templates.find((t) => t.id === device?.template_id);
  const typeName = template ? types.find((t) => t.id === template.device_type_id)?.name ?? '—' : '—';

  // Свободные порты всех устройств — из них выбирают, куда подключить порт.
  const freeEntries: FreeEntry[] = useMemo(() => {
    const out: FreeEntry[] = [];
    // Свободен тот порт, в котором нет кабеля вообще. Подвешенный кабель
    // тоже воткнут — такой порт занят, хоть на другом конце и пусто.
    for (const d of devices) for (const i of d.interfaces) if (!i.link_id) out.push({ device: d, iface: i });
    return out;
  }, [devices]);

  if (isLoading) return <Text c="dimmed">Загрузка…</Text>;
  if (!device) {
    return (
      <Stack>
        <Title order={2}>Устройство не найдено</Title>
        <Text c="dimmed">Возможно, оно удалено или ссылка неверна.</Text>
        <Anchor component={Link} to="/devices">К списку устройств</Anchor>
      </Stack>
    );
  }

  // Состав портов задаётся моделью; править у железки можно только там, где
  // это отражает жизнь — ПК со съёмной сетевой картой.
  const portsEditable = template?.ports_editable_on_device ?? false;

  const interfaces = [...device.interfaces].sort((a, b) => a.port_number - b.port_number);
  // Занят и тот порт, у которого второй конец кабеля повис.
  const busyCount = interfaces.filter((i) => i.link_id).length;

  function addPort() {
    const n = device!.interfaces.length + 1;
    addInterface.mutate({ deviceId: device!.id, body: { label: `Порт ${n}` } }, { onError: notifyError });
  }

  function generatePorts() {
    const n = typeof bulkCount === 'number' ? bulkCount : 0;
    if (n <= 0) return;
    if (!confirm(`Создать ${n} портов?`)) return;
    // Одним запросом: параллельные добавления читают один и тот же
    // «следующий номер» и мешают друг другу.
    addPortsBulk.mutate({ deviceId: device!.id, body: { count: n } }, { onError: notifyError });
  }

  function handleDelete() {
    if (!confirm(`Удалить устройство «${device!.code}» вместе со всеми его портами и связями?`)) return;
    deleteDevice.mutate(device!.id, {
      onSuccess: () => { notifySuccess('Устройство удалено'); navigate('/devices'); },
      onError: notifyError,
    });
  }

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <ActionIcon variant="subtle" component={Link} to="/devices" aria-label="К списку">
            <IconArrowLeft size={18} />
          </ActionIcon>
          <Title order={2}>{device.code}</Title>
          <Text c="dimmed" size="lg">{device.name || template?.name || '—'}</Text>
        </Group>
        <Group>
          <Button
            variant="light" leftSection={<IconTopologyStar size={16} />}
            component={Link} to={`/topology?device=${device.id}`}
          >
            Показать на схеме
          </Button>
          <Button variant="light" color="red" leftSection={<IconTrash size={16} />} onClick={handleDelete}>
            Удалить
          </Button>
        </Group>
      </Group>

      <Card withBorder padding="sm">
        <Group gap="xl" wrap="wrap">
          <Field label="Тип">{typeName}</Field>
          <Field label="Модель">
            {template?.color && <span className="tag-badge-dot" style={{ background: template.color }} />}
            {template?.name ?? '—'}
          </Field>
          <Field label="Производитель">{template?.manufacturer || '—'}</Field>
          <Field label="IP управления">{device.management_ip || '—'}</Field>
          <Field label="Расположение">{device.location || '—'}</Field>
          <Field label="Роль">{device.role || '—'}</Field>
          <Field label="Установлено">{device.install_date || '—'}</Field>
          <Field label="Порты">{busyCount} из {interfaces.length} занято</Field>
        </Group>
        {device.tags.length > 0 && (
          <Group gap={6} mt="sm">
            {device.tags.map((t) => (
              <Badge key={t.id} variant="outline" color={t.color ?? 'gray'}>{t.name}</Badge>
            ))}
          </Group>
        )}
        {device.notes && <Text size="sm" c="dimmed" mt="sm">{device.notes}</Text>}
      </Card>

      <Title order={3} mt="sm">Порты</Title>
      <Paper withBorder>
        <Table verticalSpacing={4}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={50}>№</Table.Th><Table.Th>Название</Table.Th><Table.Th>Разъём</Table.Th>
                <Table.Th>Режим</Table.Th><Table.Th>VLAN</Table.Th>
              <Table.Th>IP</Table.Th><Table.Th>MAC</Table.Th><Table.Th>Заметка</Table.Th>
              <Table.Th>Подключение</Table.Th><Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {interfaces.map((i) => (
              <InterfaceRow key={i.id} iface={i} vlans={vlans} freeEntries={freeEntries} portsEditable={portsEditable} />
            ))}
            {interfaces.length === 0 && (
              <Table.Tr><Table.Td colSpan={9}><Text c="dimmed" size="sm">Портов ещё нет</Text></Table.Td></Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Paper>

      {portsEditable ? (
        <Group>
          <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={addPort}>Порт</Button>
          <NumberInput size="xs" value={bulkCount} onChange={(v) => setBulkCount(v === '' ? '' : Number(v))} min={1} max={96} w={80} />
          <Button size="xs" variant="light" onClick={generatePorts}>Сгенерировать N портов</Button>
          <Text size="xs" c="dimmed">
            У этой модели состав портов меняется по факту, поэтому порты правятся прямо здесь.
          </Text>
        </Group>
      ) : (
        <Text size="sm" c="dimmed">
          Состав портов задаётся моделью. Чтобы добавить или убрать порт, откройте
          {' '}<Anchor component={Link} to="/templates">шаблон «{template?.name}»</Anchor>{' '}
          — изменение применится ко всем устройствам этой модели.
        </Text>
      )}
    </Stack>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Text size="xs" c="dimmed">{label}</Text>
      <Text size="sm">{children}</Text>
    </div>
  );
}
