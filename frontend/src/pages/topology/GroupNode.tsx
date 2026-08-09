import { NodeResizer, NodeToolbar, Position, type Node, type NodeProps } from '@xyflow/react';
import { ActionIcon, Group, Paper, Text, Tooltip } from '@mantine/core';
import { IconFolderPlus, IconPencil, IconTrash } from '@tabler/icons-react';
import { useTopologyActions } from './actions';
import { tint, useAppearance } from './appearance';

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
/** Меньше рамку не ужать: в неё перестанет помещаться даже один узел. */
export const GROUP_MIN_SIZE = { width: 240, height: 130 };

/** Рамка группы устройств на топологии.
 *
 * Рисуется постфактум вокруг уже сложившегося кластера (см. layout.ts), сама
 * не участвует в физике. Группы вкладываются: рамка участка лежит внутри
 * рамки цеха — это обычный вложенный узел React Flow (parentId), поэтому
 * дети двигаются вместе с родителем.
 *
 * Вложенные рамки бледнее внешних: иначе на третьем уровне заливка
 * складывается втрое и устройства тонут в цвете.
 *
 * Как именно выглядит рамка — контур, заливка, скругление, место подписи —
 * решает человек в настройках вида (см. appearance.ts); здесь только
 * умолчания и правила вложенности.
 */
export function GroupNode({ id, data, selected }: NodeProps<GroupNodeType>) {
  const actions = useTopologyActions();
  const look = useAppearance();
  const groupId = parseInt(id.replace('group-', ''), 10);

  // Чем глубже рамка, тем слабее и заливка, и контур.
  const fade = [1, 0.6, 0.4][Math.min(data.depth, 2)];

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        border: look.groupBorder === 'none'
          ? undefined
          : `${look.groupBorderWidth}px ${look.groupBorder} ${tint(data.color, 100 * fade)}`,
        borderRadius: look.groupRadius,
        background: look.groupFill > 0 ? tint(data.color, look.groupFill * fade) : undefined,
        outline: selected ? `2px solid ${data.color}` : undefined,
        outlineOffset: 2,
      }}
    >
      {/* Рамку тянут за углы и стороны. Ручки показываются только у
          выделенной группы — иначе они ловят клики по устройствам, которые
          стоят у самого края. */}
      <NodeResizer
        isVisible={selected}
        minWidth={GROUP_MIN_SIZE.width}
        minHeight={GROUP_MIN_SIZE.height}
        color={data.color}
        onResizeEnd={(_event, size) => actions?.resizeGroup(groupId, size)}
      />

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

      {look.groupTitle !== 'hidden' && (
        // «Врезкой» — подпись сидит верхом на контуре, как надпись на
        // чертеже: она не отъедает место внутри рамки и не наезжает на
        // устройства, стоящие вплотную к верхнему краю.
        <Group
          gap={6}
          wrap="nowrap"
          style={look.groupTitle === 'onFrame'
            ? {
              position: 'absolute', top: 0, left: 12, transform: 'translateY(-50%)',
              maxWidth: 'calc(100% - 24px)', padding: '0 6px', borderRadius: 6,
              background: 'var(--mantine-color-body)',
            }
            : { padding: '4px 8px', height: GROUP_HEADER_HEIGHT }}
        >
          <Text size="xs" fw={600} style={{ color: data.color }} truncate>{data.name}</Text>
          {look.groupCount && (
            <Text size="10px" c="dimmed" style={{ flexShrink: 0 }}>{data.deviceCount}</Text>
          )}
        </Group>
      )}
    </div>
  );
}
