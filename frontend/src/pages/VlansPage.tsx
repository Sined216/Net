import { useState } from 'react';
import { ActionIcon, Alert, Button, Group, Modal, NumberInput, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
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
                    <ActionIcon variant="subtle" onClick={() => setEditing(v)} title="Изменить">
                      <IconPencil size={16} />
                    </ActionIcon>
                    <ActionIcon variant="subtle" color="red" onClick={() => handleDelete(v.id)} title="Удалить">
                      <IconTrash size={16} />
                    </ActionIcon>
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (num === '') return;
    const body = { vlan_number: num, name: nn(name), subnet: nn(subnet), gateway: nn(gateway), dhcp_range: nn(dhcp), notes: nn(notes) };
    if (vlan) {
      updateVlan.mutate(
        { id: vlan.id, body },
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
            <NumberInput label="Номер" value={num} onChange={(v) => setNum(v === '' ? '' : Number(v))} required min={1} max={4094} />
            <TextInput label="Название" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          </Group>
          <Group grow>
            <TextInput label="Подсеть" placeholder="10.10.20.0/24" value={subnet} onChange={(e) => setSubnet(e.currentTarget.value)} />
            <TextInput label="Шлюз" placeholder="10.10.20.1" value={gateway} onChange={(e) => setGateway(e.currentTarget.value)} />
          </Group>
          <TextInput label="DHCP-диапазон" value={dhcp} onChange={(e) => setDhcp(e.currentTarget.value)} />
          <TextInput label="Заметки" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
          <Group justify="flex-end" mt="sm">
            <Button type="submit" loading={saving}>
              {vlan ? 'Сохранить' : 'Создать'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
