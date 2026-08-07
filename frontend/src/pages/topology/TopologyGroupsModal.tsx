import { useState } from 'react';
import { ActionIcon, Button, ColorInput, Group, Modal, Table, Text, TextInput } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useCreateTopologyGroup, useDeleteTopologyGroup, useTopologyGroups } from '../../api/hooks';
import { notifyError, notifySuccess } from '../../lib/notify';

export function TopologyGroupsModal({ onClose }: { onClose: () => void }) {
  const { data: groups = [] } = useTopologyGroups();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#94a3b8');
  const createGroup = useCreateTopologyGroup();
  const deleteGroup = useDeleteTopologyGroup();

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createGroup.mutate(
      { name: name.trim(), color },
      {
        onSuccess: () => { notifySuccess('Группа создана'); setName(''); },
        onError: notifyError,
      },
    );
  }

  function handleDelete(id: number, groupName: string) {
    if (!confirm(`Удалить группу «${groupName}»? У устройств этой группы она просто снимется.`)) return;
    deleteGroup.mutate(id, { onSuccess: () => notifySuccess('Группа удалена'), onError: notifyError });
  }

  return (
    <Modal opened onClose={onClose} title="Группы на топологии">
      <Text size="sm" c="dimmed" mb="sm">
        Отдельный от тегов параметр — ровно одна группа на устройство. Используется только для визуальной
        кластеризации на схеме связей (рамка вокруг устройств одной группы).
      </Text>
      <Table withTableBorder verticalSpacing="xs" mb="sm">
        <Table.Tbody>
          {groups.map((g) => (
            <Table.Tr key={g.id}>
              <Table.Td>
                <span className="tag-badge-dot" style={{ background: g.color ?? '#94a3b8' }} />
                {g.name}
              </Table.Td>
              <Table.Td w={40}>
                <ActionIcon variant="subtle" color="red" onClick={() => handleDelete(g.id, g.name)}>
                  <IconTrash size={16} />
                </ActionIcon>
              </Table.Td>
            </Table.Tr>
          ))}
          {groups.length === 0 && (
            <Table.Tr><Table.Td colSpan={2}><Text c="dimmed">Групп ещё нет</Text></Table.Td></Table.Tr>
          )}
        </Table.Tbody>
      </Table>
      <form onSubmit={handleAdd}>
        <Group align="flex-end">
          <TextInput label="Новая группа" placeholder="напр. Цех 1" value={name} onChange={(e) => setName(e.currentTarget.value)} style={{ flex: 1 }} />
          <ColorInput label="Цвет" value={color} onChange={setColor} w={110} />
          <Button type="submit" leftSection={<IconPlus size={16} />} loading={createGroup.isPending}>Добавить</Button>
        </Group>
      </form>
    </Modal>
  );
}
