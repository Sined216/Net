import { useState } from 'react';
import { ActionIcon, Badge, Button, Card, Collapse, Group, NumberInput, Table, Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconEdit, IconExternalLink, IconPlus, IconTrash } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { useAddInterface, useDeleteDevice } from '../../api/hooks';
import { notifyError, notifySuccess } from '../../lib/notify';
import { InterfaceRow, type FreeEntry } from './InterfaceRow';
import type { DeviceOut, DeviceTemplateOut, DeviceTypeOut, VlanOut } from '../../api/types';

export function DeviceCard({
  device, template, typeName, vlans, freeEntries, onEdit,
}: {
  device: DeviceOut;
  template: DeviceTemplateOut | undefined;
  typeName: string;
  vlans: VlanOut[];
  freeEntries: FreeEntry[];
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [bulkCount, setBulkCount] = useState<number | ''>(24);
  const deleteDevice = useDeleteDevice();
  const addInterface = useAddInterface();

  const portsEditable = template?.ports_editable_on_device ?? false;

  const ifaces = [...device.interfaces].sort((a, b) => a.port_number - b.port_number);
  const displayName = device.name || template?.name || '—';

  function handleDelete() {
    if (!confirm(`Удалить устройство "${device.code}" вместе со всеми его портами и связями?`)) return;
    deleteDevice.mutate(device.id, { onSuccess: () => notifySuccess('Устройство удалено'), onError: notifyError });
  }

  function addPort() {
    const n = device.interfaces.length + 1;
    addInterface.mutate({ deviceId: device.id, body: { label: `Порт ${n}` } }, { onError: notifyError });
  }

  function generatePorts() {
    const n = typeof bulkCount === 'number' ? bulkCount : 0;
    if (n <= 0) return;
    if (!confirm(`Создать ${n} портов ("Порт 1".."Порт ${n}")?`)) return;
    const start = device.interfaces.length + 1;
    for (let i = start; i < start + n; i++) {
      addInterface.mutate({ deviceId: device.id, body: { label: `Порт ${i}` } });
    }
  }

  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" wrap="nowrap">
        <UnstyledButton onClick={() => setOpen((o) => !o)} style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" wrap="wrap">
            {open ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
            <Text fw={700}>{device.code}</Text>
            <Text c="dimmed">{displayName}</Text>
            <Badge variant="light">{typeName}</Badge>
            {device.name && template && <Badge variant="light" color="grape">{template.name}</Badge>}
            {device.management_ip && <Badge variant="light" color="gray">{device.management_ip}</Badge>}
            <Badge variant="light" color="gray">{ifaces.length} порт(ов)</Badge>
            {device.tags.map((t) => (
              <Badge key={t.id} variant="outline" color={t.color ?? 'gray'} title={t.name}>
                {t.name}
              </Badge>
            ))}
          </Group>
        </UnstyledButton>
        <Group gap={4} wrap="nowrap">
          <ActionIcon variant="subtle" component={Link} to={`/devices/${device.id}`} title="Открыть страницу устройства">
            <IconExternalLink size={16} />
          </ActionIcon>
          <ActionIcon variant="subtle" onClick={onEdit}><IconEdit size={16} /></ActionIcon>
          <ActionIcon variant="subtle" color="red" onClick={handleDelete}><IconTrash size={16} /></ActionIcon>
        </Group>
      </Group>

      <Collapse expanded={open}>
        <div style={{ marginTop: 12 }}>
          {device.location && <Text size="sm" c="dimmed">Расположение: {device.location}</Text>}
          {device.notes && <Text size="sm" c="dimmed">{device.notes}</Text>}
          <Table withTableBorder verticalSpacing={4} mt="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={50}>№</Table.Th><Table.Th>Название</Table.Th><Table.Th>Разъём</Table.Th>
                <Table.Th>Режим</Table.Th><Table.Th>VLAN</Table.Th>
                <Table.Th>IP</Table.Th><Table.Th>MAC</Table.Th><Table.Th>Заметка</Table.Th><Table.Th>Подключение</Table.Th><Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {ifaces.map((i) => (
                <InterfaceRow key={i.id} iface={i} vlans={vlans} freeEntries={freeEntries} portsEditable={portsEditable} />
              ))}
              {ifaces.length === 0 && (
                <Table.Tr><Table.Td colSpan={9}><Text c="dimmed" size="sm">Портов ещё нет</Text></Table.Td></Table.Tr>
              )}
            </Table.Tbody>
          </Table>
          {portsEditable ? (
            <Group mt="xs">
              <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={addPort}>Порт</Button>
              <NumberInput size="xs" value={bulkCount} onChange={(v) => setBulkCount(v === '' ? '' : Number(v))} min={1} max={96} w={70} />
              <Button size="xs" variant="light" onClick={generatePorts}>Сгенерировать N портов</Button>
            </Group>
          ) : (
            <Text size="xs" c="dimmed" mt="xs">
              Состав портов задаётся моделью — правится в шаблоне «{template?.name}».
            </Text>
          )}
        </div>
      </Collapse>
    </Card>
  );
}

export function typeNameForTemplate(template: DeviceTemplateOut | undefined, types: DeviceTypeOut[]): string {
  if (!template) return '—';
  return types.find((t) => t.id === template.device_type_id)?.name ?? '—';
}
