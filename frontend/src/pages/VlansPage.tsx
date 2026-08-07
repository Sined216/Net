import { useState } from 'react';
import { ActionIcon, Alert, Button, Group, Modal, NumberInput, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useCreateVlan, useDeleteVlan, useVlans } from '../api/hooks';
import { nn } from '../lib/utils';
import { notifyError, notifySuccess } from '../lib/notify';

export function VlansPage() {
  const { data: vlans = [], isLoading, error } = useVlans();
  const [opened, setOpened] = useState(false);
  const deleteVlan = useDeleteVlan();

  function handleDelete(id: number) {
    if (!confirm('Удалить VLAN?')) return;
    deleteVlan.mutate(id, { onSuccess: () => notifySuccess('VLAN удалён'), onError: notifyError });
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>VLAN</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setOpened(true)}>
          VLAN
        </Button>
      </Group>

      {error && <Alert color="red">{(error as Error).message}</Alert>}

      <Table withTableBorder verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>№</Table.Th>
            <Table.Th>Название</Table.Th>
            <Table.Th>Подсеть</Table.Th>
            <Table.Th>Шлюз</Table.Th>
            <Table.Th w={60} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {vlans.map((v) => (
            <Table.Tr key={v.id}>
              <Table.Td>{v.vlan_number}</Table.Td>
              <Table.Td>{v.name || '—'}</Table.Td>
              <Table.Td>{v.subnet || '—'}</Table.Td>
              <Table.Td>{v.gateway || '—'}</Table.Td>
              <Table.Td>
                <ActionIcon variant="subtle" color="red" onClick={() => handleDelete(v.id)}>
                  <IconTrash size={16} />
                </ActionIcon>
              </Table.Td>
            </Table.Tr>
          ))}
          {!isLoading && vlans.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={5}>
                <Text c="dimmed">VLAN ещё не заведены</Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      {opened && <VlanFormModal onClose={() => setOpened(false)} />}
    </Stack>
  );
}

function VlanFormModal({ onClose }: { onClose: () => void }) {
  const [num, setNum] = useState<number | ''>('');
  const [name, setName] = useState('');
  const [subnet, setSubnet] = useState('');
  const [gateway, setGateway] = useState('');
  const [dhcp, setDhcp] = useState('');
  const [notes, setNotes] = useState('');
  const createVlan = useCreateVlan();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (num === '') return;
    createVlan.mutate(
      { vlan_number: num, name: nn(name), subnet: nn(subnet), gateway: nn(gateway), dhcp_range: nn(dhcp), notes: nn(notes) },
      { onSuccess: () => { notifySuccess('VLAN создан'); onClose(); }, onError: notifyError },
    );
  }

  return (
    <Modal opened onClose={onClose} title="Новый VLAN">
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
            <Button type="submit" loading={createVlan.isPending}>
              Создать
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
