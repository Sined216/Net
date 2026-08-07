import { useState } from 'react';
import { ActionIcon, Group, Select, Table, Text, TextInput } from '@mantine/core';
import { IconCheck, IconTrash } from '@tabler/icons-react';
import { useCreateLink, useDeleteInterface, useDeleteLink, useUpdateInterface } from '../../api/hooks';
import { nn, nnInt } from '../../lib/utils';
import { notifyError, notifySuccess } from '../../lib/notify';
import type { DeviceOut, InterfaceOut, PortType, VlanOut } from '../../api/types';

const PORT_TYPES: PortType[] = ['access', 'trunk', 'uplink'];

export interface FreeEntry {
  device: DeviceOut;
  iface: InterfaceOut;
}

export function InterfaceRow({
  iface, vlans, freeEntries,
}: {
  iface: InterfaceOut;
  vlans: VlanOut[];
  freeEntries: FreeEntry[];
}) {
  const [label, setLabel] = useState(iface.label);
  const [portNumber, setPortNumber] = useState<string>(iface.port_number != null ? String(iface.port_number) : '');
  const [portType, setPortType] = useState<string | null>(iface.port_type);
  const [vlanId, setVlanId] = useState<string | null>(iface.vlan_id != null ? String(iface.vlan_id) : null);
  const [ip, setIp] = useState(iface.ip ?? '');
  const [mac, setMac] = useState(iface.mac ?? '');
  const [notes, setNotes] = useState(iface.notes ?? '');
  const [connectTarget, setConnectTarget] = useState<string | null>(null);

  const updateInterface = useUpdateInterface();
  const deleteInterface = useDeleteInterface();
  const createLink = useCreateLink();
  const deleteLink = useDeleteLink();

  function save() {
    updateInterface.mutate(
      {
        id: iface.id,
        body: { label: label.trim(), port_number: nnInt(portNumber), port_type: (portType as PortType) || null, vlan_id: nnInt(vlanId), ip: nn(ip), mac: nn(mac), notes: nn(notes) },
      },
      { onSuccess: () => notifySuccess('Порт сохранён'), onError: notifyError },
    );
  }

  function remove() {
    if (!confirm('Удалить порт? Связанная связь (если есть) тоже будет удалена.')) return;
    deleteInterface.mutate(iface.id, { onError: notifyError });
  }

  function connect() {
    if (!connectTarget) { notifyError(new Error('Выберите порт для подключения')); return; }
    createLink.mutate(
      { interface_a_id: iface.id, interface_b_id: parseInt(connectTarget, 10) },
      { onSuccess: () => notifySuccess('Связь создана'), onError: notifyError },
    );
  }

  function disconnect() {
    if (!iface.connected_to) return;
    if (!confirm('Удалить связь?')) return;
    deleteLink.mutate(iface.connected_to.link_id, { onSuccess: () => notifySuccess('Связь удалена'), onError: notifyError });
  }

  const connectData = groupFreeEntries(freeEntries, iface.id);

  return (
    <Table.Tr>
      <Table.Td><TextInput size="xs" value={label} onChange={(e) => setLabel(e.currentTarget.value)} w={80} /></Table.Td>
      <Table.Td><TextInput size="xs" value={portNumber} onChange={(e) => setPortNumber(e.currentTarget.value)} w={55} /></Table.Td>
      <Table.Td>
        <Select size="xs" data={PORT_TYPES} value={portType} onChange={setPortType} clearable w={100} />
      </Table.Td>
      <Table.Td>
        <Select
          size="xs" w={130} clearable
          data={vlans.map((v) => ({ value: String(v.id), label: `${v.vlan_number} ${v.name ?? ''}`.trim() }))}
          value={vlanId} onChange={setVlanId}
        />
      </Table.Td>
      <Table.Td><TextInput size="xs" placeholder="IP" value={ip} onChange={(e) => setIp(e.currentTarget.value)} w={100} /></Table.Td>
      <Table.Td><TextInput size="xs" placeholder="MAC" value={mac} onChange={(e) => setMac(e.currentTarget.value)} w={110} /></Table.Td>
      <Table.Td><TextInput size="xs" placeholder="заметка" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} w={90} /></Table.Td>
      <Table.Td>
        {iface.connected_to ? (
          <Group gap={4} wrap="nowrap">
            <Text size="xs" c="teal">→ {iface.connected_to.device_code} · {iface.connected_to.interface_label}</Text>
            <ActionIcon size="sm" variant="subtle" color="red" onClick={disconnect}><IconTrash size={14} /></ActionIcon>
          </Group>
        ) : (
          <Group gap={4} wrap="nowrap">
            <Select size="xs" w={150} placeholder="— свободен —" data={connectData} value={connectTarget} onChange={setConnectTarget} searchable />
            <ActionIcon size="sm" variant="subtle" onClick={connect}>
              <IconCheck size={14} />
            </ActionIcon>
          </Group>
        )}
      </Table.Td>
      <Table.Td>
        <Group gap={4} wrap="nowrap">
          <ActionIcon size="sm" variant="subtle" onClick={save}><IconCheck size={14} /></ActionIcon>
          <ActionIcon size="sm" variant="subtle" color="red" onClick={remove}><IconTrash size={14} /></ActionIcon>
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

/** Группирует свободные порты по устройству (устройство -> порт), уже
 * подключённые порты сюда не попадают вовсе. */
function groupFreeEntries(entries: FreeEntry[], excludeIfaceId: number) {
  const byDevice = new Map<number, { device: DeviceOut; items: { value: string; label: string }[] }>();
  for (const e of entries) {
    if (e.iface.id === excludeIfaceId) continue;
    if (!byDevice.has(e.device.id)) byDevice.set(e.device.id, { device: e.device, items: [] });
    byDevice.get(e.device.id)!.items.push({ value: String(e.iface.id), label: e.iface.label });
  }
  return [...byDevice.values()]
    .sort((a, b) => a.device.code.localeCompare(b.device.code))
    .map(({ device, items }) => ({ group: device.name ? `${device.code} — ${device.name}` : device.code, items }));
}
