import { useState } from 'react';
import { ActionIcon, Badge, Group, Select, Table, Text, TextInput } from '@mantine/core';
import { IconCheck, IconPlugConnected, IconTrash } from '@tabler/icons-react';
import {
  useAttachLinkEnd, useCreateLink, useDeleteInterface, useDeleteLink, useModules, useUpdateInterface,
} from '../../api/hooks';
import { nn, nnInt } from '../../lib/utils';
import { notifyError, notifySuccess } from '../../lib/notify';
import type { DeviceOut, InterfaceOut, PortMode, VlanOut } from '../../api/types';

// Режим — настройка конкретной железки; в модели техники его нет.
const PORT_MODES: PortMode[] = ['access', 'trunk', 'uplink'];

export interface FreeEntry {
  device: DeviceOut;
  iface: InterfaceOut;
}

export function InterfaceRow({
  iface, vlans, freeEntries, portsEditable = false,
}: {
  iface: InterfaceOut;
  vlans: VlanOut[];
  freeEntries: FreeEntry[];
  /** Разрешает удалять порт — только у моделей со съёмными картами. */
  portsEditable?: boolean;
}) {
  const [mode, setMode] = useState<string | null>(iface.mode);
  const [moduleId, setModuleId] = useState<string | null>(
    iface.module ? String(iface.module.id) : null,
  );
  const [vlanId, setVlanId] = useState<string | null>(iface.vlan_id != null ? String(iface.vlan_id) : null);
  const [ip, setIp] = useState(iface.ip ?? '');
  const [mac, setMac] = useState(iface.mac ?? '');
  const [notes, setNotes] = useState(iface.notes ?? '');
  const [connectTarget, setConnectTarget] = useState<string | null>(null);

  const { data: modules = [] } = useModules();
  const updateInterface = useUpdateInterface();
  const deleteInterface = useDeleteInterface();
  const createLink = useCreateLink();
  const deleteLink = useDeleteLink();
  const attachEnd = useAttachLinkEnd();

  function save() {
    updateInterface.mutate(
      {
        id: iface.id,
        // Ни номера, ни названия: они описывают модель техники и правятся в
        // шаблоне. Здесь — только то, что у каждого экземпляра своё.
        body: {
          mode: (mode as PortMode) || null,
          // Модуль вставляется только в клетку; у обычного разъёма поля нет,
          // и его значение не отправляется.
          ...(isCage ? { module_id: nnInt(moduleId) } : {}),
          vlan_id: nnInt(vlanId), ip: nn(ip), mac: nn(mac), notes: nn(notes),
        },
      },
      { onSuccess: () => notifySuccess('Порт сохранён'), onError: notifyError },
    );
  }

  function remove() {
    const warning = iface.link_id
      ? 'Убрать порт? Кабель останется задокументированным, но его конец повиснет — подключить заново можно к другому порту.'
      : 'Убрать порт?';
    if (!confirm(warning)) return;
    deleteInterface.mutate(iface.id, { onError: notifyError });
  }

  /** Второй конец кабеля повис (там сняли порт) — втыкаем его в выбранный. */
  function attach() {
    if (!connectTarget || !iface.link_id) return;
    attachEnd.mutate(
      { id: iface.link_id, interfaceId: parseInt(connectTarget, 10) },
      { onSuccess: () => notifySuccess('Кабель подключён'), onError: notifyError },
    );
  }

  function connect() {
    if (!connectTarget) { notifyError(new Error('Выберите порт для подключения')); return; }
    createLink.mutate(
      { interface_a_id: iface.id, interface_b_id: parseInt(connectTarget, 10) },
      { onSuccess: () => notifySuccess('Связь создана'), onError: notifyError },
    );
  }

  function disconnect() {
    const linkId = iface.connected_to?.link_id ?? iface.link_id;
    if (!linkId) return;
    if (!confirm('Удалить связь?')) return;
    deleteLink.mutate(linkId, { onSuccess: () => notifySuccess('Связь удалена'), onError: notifyError });
  }

  const connectData = groupFreeEntries(freeEntries, iface.id);
  const isCage = !!iface.connector?.is_cage;
  // Клетка без модуля: гнездо есть, а воткнуть в него физически нечего.
  const emptyCage = iface.empty_cage;
  // Модули для этой клетки: остальные сюда не вставляются.
  const moduleOptions = modules
    .filter((m) => m.cage_connector_id == null || m.cage_connector_id === iface.connector?.id)
    .map((m) => ({ value: String(m.id), label: m.name }));
  // Кабель воткнут, но на том конце порта уже нет. Порт занят, а подключение
  // недоделано — тем же оранжевым, что и заглушка на схеме, чтобы такие
  // порты было видно, не вчитываясь в столбец подключения.
  const dangling = !!iface.link_id && !iface.connected_to;

  return (
    <Table.Tr>
      {/* Номер и название приходят из шаблона модели и здесь только
          показываются: правка на устройстве разводила бы одинаковые железки
          по названиям портов. */}
      <Table.Td><Text size="xs" fw={600} c={dangling ? 'orange' : undefined}>{iface.port_number}</Text></Table.Td>
      <Table.Td><Text size="xs" c={dangling ? 'orange' : undefined}>{iface.label}</Text></Table.Td>
      <Table.Td>
        {/* Разъём приходит из модели и правится там же. У клетки показываем,
            что в неё вставлено: пустая клетка — это не свободный порт. */}
        {isCage ? (
          <Group gap={4} wrap="nowrap">
            <Select
              size="xs" w={140} clearable searchable
              placeholder={`${iface.connector?.name ?? 'клетка'} — пусто`}
              data={moduleOptions} value={moduleId} onChange={setModuleId}
            />
            {emptyCage && <Badge size="xs" variant="light" color="orange">нет модуля</Badge>}
          </Group>
        ) : (
          <Text size="xs" c="dimmed">{iface.connector?.name ?? '—'}</Text>
        )}
      </Table.Td>
      <Table.Td>
        <Select size="xs" data={PORT_MODES} value={mode} onChange={setMode} clearable w={100} />
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
        ) : iface.link_id ? (
          // Кабель воткнут, но на том конце порт удалили — предлагаем
          // подключить его заново, а не заводить связь с нуля: длина,
          // разъём и заметки останутся при ней.
          <Group gap={4} wrap="nowrap">
            <Select
              size="xs" w={150} placeholder="повис — куда воткнуть?" data={connectData}
              value={connectTarget} onChange={setConnectTarget} searchable
            />
            <ActionIcon size="sm" variant="subtle" color="orange" onClick={attach} title="Подключить второй конец">
              <IconPlugConnected size={14} />
            </ActionIcon>
            <ActionIcon size="sm" variant="subtle" color="red" onClick={disconnect} title="Убрать кабель">
              <IconTrash size={14} />
            </ActionIcon>
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
          {portsEditable && (
            <ActionIcon size="sm" variant="subtle" color="red" onClick={remove} title="Убрать порт">
              <IconTrash size={14} />
            </ActionIcon>
          )}
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
