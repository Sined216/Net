import { useState } from 'react';
import { ActionIcon, Button, Group, Modal, Stack, Table, Text } from '@mantine/core';
import { IconFolderPlus, IconPencil, IconPlus, IconServer2, IconTrash } from '@tabler/icons-react';
import { useDeleteTopologyGroup, useTopologyGroups } from '../../api/hooks';
import { notifyError, notifySuccess } from '../../lib/notify';
import { GroupEditModal } from './GroupEditModal';
import { orderedGroups } from './groups';
import type { TopologyGroupOut } from '../../api/types';

/** Список групп деревом: цех — участок — линия.
 *
 * Здесь заводят группы, которых на схеме ещё не видно: пока в группе нет ни
 * одного устройства, рамки не существует, и панель действий на ней открыть
 * негде.
 */
export function TopologyGroupsModal({ onClose }: { onClose: () => void }) {
  const { data: groups = [] } = useTopologyGroups();
  const deleteGroup = useDeleteTopologyGroup();
  const [editing, setEditing] = useState<{ group: TopologyGroupOut | null; parentId: number | null } | null>(null);

  function handleDelete(group: TopologyGroupOut) {
    if (!confirm(`Удалить группу «${group.name}»? Устройства останутся, подгруппы поднимутся на уровень выше.`)) return;
    deleteGroup.mutate(group.id, { onSuccess: () => notifySuccess('Группа удалена'), onError: notifyError });
  }

  const rows = orderedGroups(groups);

  return (
    <Modal opened onClose={onClose} title="Группы на топологии" size="lg">
      <Stack>
        <Text size="sm" c="dimmed">
          Отдельный от тегов параметр — ровно одна группа на устройство, самая внутренняя. Группы вкладываются
          друг в друга: цех — участок — линия. Рамка появляется на схеме, когда в группе есть хотя бы одно
          устройство.
        </Text>

        <Table withTableBorder verticalSpacing="xs">
          <Table.Tbody>
            {rows.map(({ group, depth }) => {
              // Сколько устройств в группе, считает сервер: возить ради
              // этой цифры всю спецификацию незачем.
              const count = group.device_count;
              return (
                <Table.Tr key={group.id}>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap" style={{ paddingLeft: depth * 22 }}>
                      <span className="tag-badge-dot" style={{ background: group.color ?? '#94a3b8' }} />
                      <Text size="sm">{group.name}</Text>
                      {group.kind === 'cabinet' && (
                        <IconServer2 size={13} color="var(--mantine-color-dimmed)" title="Шкаф" />
                      )}
                      <Text size="xs" c="dimmed">{count} уст.</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td w={110}>
                    <Group gap={2} justify="flex-end" wrap="nowrap">
                      <ActionIcon variant="subtle" size="sm" title="Правка и состав"
                        onClick={() => setEditing({ group, parentId: null })}>
                        <IconPencil size={15} />
                      </ActionIcon>
                      {group.kind !== 'cabinet' && (
                        <ActionIcon variant="subtle" size="sm" title="Добавить подгруппу"
                          onClick={() => setEditing({ group: null, parentId: group.id })}>
                          <IconFolderPlus size={15} />
                        </ActionIcon>
                      )}
                      <ActionIcon variant="subtle" size="sm" color="red" title="Удалить"
                        onClick={() => handleDelete(group)}>
                        <IconTrash size={15} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
            {rows.length === 0 && (
              <Table.Tr><Table.Td colSpan={2}><Text c="dimmed">Групп ещё нет</Text></Table.Td></Table.Tr>
            )}
          </Table.Tbody>
        </Table>

        <Group justify="flex-end">
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ group: null, parentId: null })}>
            Группа
          </Button>
        </Group>
      </Stack>

      {editing && (
        <GroupEditModal group={editing.group} parentId={editing.parentId} onClose={() => setEditing(null)} />
      )}
    </Modal>
  );
}
