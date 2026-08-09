import { NodeToolbar, Position, type Node, type NodeProps } from '@xyflow/react';
import { ActionIcon, Group, Paper, Text, Tooltip } from '@mantine/core';
import { IconFolderPlus, IconPencil, IconTrash } from '@tabler/icons-react';
import { useTopologyActions } from './actions';

export interface GroupNodeData extends Record<string, unknown> {
  name: string;
  color: string;
  /** Уровень вложенности: 0 — цех, 1 — участок, 2 — линия. */
  depth: number;
  /** Сколько устройств внутри, вместе с подгруппами. */
  deviceCount: number;
}

export type GroupNodeType = Node<GroupNodeData, 'group'>;

export const GROUP_HEADER_HEIGHT = 26;

/** Рамка группы устройств на топологии.
 *
 * Рисуется постфактум вокруг уже сложившегося кластера (см. layout.ts), сама
 * не участвует в физике. Группы вкладываются: рамка участка лежит внутри
 * рамки цеха — это обычный вложенный узел React Flow (parentId), поэтому
 * дети двигаются вместе с родителем.
 *
 * Вложенные рамки заливаются слабее внешних: иначе на третьем уровне фон
 * складывается втрое и устройства тонут в цвете.
 */
export function GroupNode({ id, data, selected }: NodeProps<GroupNodeType>) {
  const actions = useTopologyActions();
  const groupId = parseInt(id.replace('group-', ''), 10);
  const fill = data.depth === 0 ? '14' : '0d';

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        border: `1.5px ${data.depth === 0 ? 'dashed' : 'dotted'} ${data.color}`,
        borderRadius: 10,
        background: `${data.color}${fill}`,
        outline: selected ? `2px solid ${data.color}` : undefined,
        outlineOffset: 2,
      }}
    >
      {actions && (
        <NodeToolbar isVisible={selected} position={Position.Top} offset={6}>
          <Paper withBorder shadow="sm" p={2} radius="md">
            <Group gap={2} wrap="nowrap">
              <Tooltip label="Название, цвет и состав группы">
                <ActionIcon variant="subtle" size="sm" onClick={() => actions.editGroup(groupId)}>
                  <IconPencil size={15} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Добавить подгруппу">
                <ActionIcon variant="subtle" size="sm" onClick={() => actions.addSubgroup(groupId)}>
                  <IconFolderPlus size={15} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Удалить группу — устройства останутся">
                <ActionIcon variant="subtle" size="sm" color="red" onClick={() => actions.removeGroup(groupId)}>
                  <IconTrash size={15} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Paper>
        </NodeToolbar>
      )}

      <Group gap={6} wrap="nowrap" style={{ padding: '4px 8px', height: GROUP_HEADER_HEIGHT }}>
        <Text size="xs" fw={600} style={{ color: data.color }} truncate>{data.name}</Text>
        <Text size="10px" c="dimmed" style={{ flexShrink: 0 }}>{data.deviceCount}</Text>
      </Group>
    </div>
  );
}
