import { Text } from '@mantine/core';
import type { Node, NodeProps } from '@xyflow/react';

export interface GroupNodeData extends Record<string, unknown> {
  name: string;
  color: string;
}

export type GroupNodeType = Node<GroupNodeData, 'group'>;

/** Рамка группы устройств на топологии — рисуется постфактум вокруг уже
 * сложившегося кластера (см. layout.ts), сама не участвует в физике. */
export function GroupNode({ data }: NodeProps<GroupNodeType>) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        border: `1.5px dashed ${data.color}`,
        borderRadius: 10,
        background: `${data.color}14`,
      }}
    >
      <Text size="xs" fw={600} style={{ color: data.color, padding: '4px 8px' }}>
        {data.name}
      </Text>
    </div>
  );
}
