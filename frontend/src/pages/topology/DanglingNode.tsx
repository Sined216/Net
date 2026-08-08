import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Text, Tooltip } from '@mantine/core';

export interface DanglingNodeData extends Record<string, unknown> {
  /** Откуда тянется кабель — чтобы подсказка объясняла, что это такое. */
  fromLabel: string;
}

export type DanglingNodeType = Node<DanglingNodeData, 'dangling'>;

export const DANGLING_NODE_SIZE = 18;

/** Свободный конец кабеля.
 *
 * Порт, в который он был воткнут, удалили — например сняли с ПК сетевую
 * карту. Кабель при этом никуда не делся, поэтому на схеме он рисуется до
 * конца и упирается в такую заглушку, а не пропадает вместе с портом. */
export function DanglingNode({ data }: NodeProps<DanglingNodeType>) {
  return (
    <Tooltip label={`Кабель от ${data.fromLabel} — второй конец не подключён`}>
      <div
        style={{
          width: DANGLING_NODE_SIZE,
          height: DANGLING_NODE_SIZE,
          borderRadius: '50%',
          border: '2px dashed var(--mantine-color-orange-6)',
          background: 'var(--mantine-color-body)',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: 'none' }} />
        <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: 'none' }} />
        <Text size="9px" c="orange" fw={700}>?</Text>
      </div>
    </Tooltip>
  );
}
