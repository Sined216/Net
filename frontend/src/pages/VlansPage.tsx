import { useState } from 'react';
import { Alert, Button, Group, Modal, NumberInput, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { DeleteAction, EditAction } from '../components/RowAction';
import { useCreateVlan, useDeleteVlan, useUpdateVlan, useVlans } from '../api/hooks';
import { nn } from '../lib/utils';
import { notifyError, notifySuccess } from '../lib/notify';
import { confirmAction } from '../lib/confirm';
import { useCan } from '../auth/permissions';
import type { VlanOut } from '../api/types';

export function VlansPage() {
  const canEdit = useCan('edit');
  const { data: vlans = [], isLoading, error } = useVlans();
  const [opened, setOpened] = useState(false);
  // Тот же модал заводит и правит: null — новый VLAN, иначе — какой правим.
  const [editing, setEditing] = useState<VlanOut | null>(null);
  const deleteVlan = useDeleteVlan();

  async function handleDelete(id: number) {
    if (!(await confirmAction('Удалить VLAN?'))) return;
    deleteVlan.mutate(id, { onSuccess: () => notifySuccess('VLAN удалён'), onError: notifyError });
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>VLAN</Title>
        {canEdit && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setOpened(true)}>
            VLAN
          </Button>
        )}
      </Group>

      {error && <Alert color="red">{(error as Error).message}</Alert>}

      <Table.ScrollContainer minWidth={900}>
        <Table withTableBorder verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>№</Table.Th>
              <Table.Th>Название</Table.Th>
              <Table.Th>Подсеть</Table.Th>
              <Table.Th>Шлюз</Table.Th>
              <Table.Th>DHCP-диапазон</Table.Th>
              <Table.Th>Заметки</Table.Th>
              <Table.Th w={80} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {vlans.map((v) => (
              <Table.Tr key={v.id}>
                <Table.Td>{v.vlan_number}</Table.Td>
                <Table.Td>{v.name || '—'}</Table.Td>
                <Table.Td>{v.subnet || '—'}</Table.Td>
                <Table.Td>{v.gateway || '—'}</Table.Td>
                <Table.Td>{v.dhcp_range || '—'}</Table.Td>
                <Table.Td>{v.notes || '—'}</Table.Td>
                <Table.Td>
                  {canEdit && (
                    <Group gap={4} wrap="nowrap">
                      <EditAction label={`Изменить VLAN ${v.vlan_number}`} onClick={() => setEditing(v)} />
                      <DeleteAction label={`Удалить VLAN ${v.vlan_number}`} onClick={() => handleDelete(v.id)} />
                    </Group>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
            {!isLoading && vlans.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={7}>
                  <Text c="dimmed">VLAN ещё не заведены</Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {opened && <VlanFormModal onClose={() => setOpened(false)} />}
      {editing && <VlanFormModal vlan={editing} onClose={() => setEditing(null)} />}
    </Stack>
  );
}

function VlanFormModal({ vlan, onClose }: { vlan?: VlanOut; onClose: () => void }) {
  const [num, setNum] = useState<number | ''>(vlan?.vlan_number ?? '');
  const [name, setName] = useState(vlan?.name ?? '');
  const [subnet, setSubnet] = useState(vlan?.subnet ?? '');
  const [gateway, setGateway] = useState(vlan?.gateway ?? '');
  const [dhcp, setDhcp] = useState(vlan?.dhcp_range ?? '');
  const [notes, setNotes] = useState(vlan?.notes ?? '');
  const createVlan = useCreateVlan();
  const updateVlan = useUpdateVlan();
  const saving = createVlan.isPending || updateVlan.isPending;
  // Сервер тоже это проверяет, но отказ формы до отправки быстрее и не
  // требует сначала нажать «Создать», чтобы узнать про допустимый диапазон.
  const outOfRange = num !== '' && (num < 1 || num > 4094);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (num === '' || outOfRange) return;
    const body = { vlan_number: num, name: nn(name), subnet: nn(subnet), gateway: nn(gateway), dhcp_range: nn(dhcp), notes: nn(notes) };
    if (vlan) {
      updateVlan.mutate(
        // Номер правки — тот, что видели при открытии формы: см.
        // app/versioning.py. Разойдётся с текущим — сервер отобьёт 409.
        { id: vlan.id, body: { ...body, version: vlan.version } },
        { onSuccess: () => { notifySuccess('VLAN сохранён'); onClose(); }, onError: notifyError },
      );
    } else {
      createVlan.mutate(
        body,
        { onSuccess: () => { notifySuccess('VLAN создан'); onClose(); }, onError: notifyError },
      );
    }
  }

  return (
    <Modal opened onClose={onClose} title={vlan ? `VLAN ${vlan.vlan_number} — правка` : 'Новый VLAN'}>
      <form onSubmit={handleSubmit}>
        <Stack>
          <Group grow>
            <NumberInput
              label="Номер" value={num} onChange={(v) => setNum(v === '' ? '' : Number(v))}
              required min={1} max={4094}
              error={outOfRange ? 'От 1 до 4094' : null}
            />
            <TextInput label="Название" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          </Group>
          <Group grow>
            <TextInput label="Подсеть" placeholder="10.10.20.0/24" value={subnet} onChange={(e) => setSubnet(e.currentTarget.value)} />
            <TextInput label="Шлюз" placeholder="10.10.20.1" value={gateway} onChange={(e) => setGateway(e.currentTarget.value)} />
          </Group>
          <TextInput label="DHCP-диапазон" value={dhcp} onChange={(e) => setDhcp(e.currentTarget.value)} />
          <TextInput label="Заметки" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
          <Group justify="flex-end" mt="sm">
            <Button type="submit" loading={saving} disabled={outOfRange}>
              {vlan ? 'Сохранить' : 'Создать'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
