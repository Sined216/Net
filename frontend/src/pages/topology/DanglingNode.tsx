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
 * конца и упирается в такую заглушку, а не пропадает вместе с портом.
 *
 * За заглушку можно потянуть мышью и бросить на нужное устройство — конец
 * воткнётся в выбранный там порт, а кабель со всеми его свойствами
 * (длина, разъём, заметки) останется прежним. Поэтому точка подключения
 * растянута на всю заглушку: целиться в маленькую метку сбоку на схеме из
 * сотен узлов неудобно.
 */
export function DanglingNode({ data }: NodeProps<DanglingNodeType>) {
  const cover = {
    position: 'absolute' as const,
    inset: 0,
    width: '100%',
    height: '100%',
    transform: 'none',
    borderRadius: '50%',
    background: 'transparent',
    border: 'none',
    minWidth: 0,
    minHeight: 0,
  };

  return (
    <Tooltip label={`Кабель от ${data.fromLabel} — потяните на устройство, чтобы подключить`}>
      <div
        style={{
          position: 'relative',
          width: DANGLING_NODE_SIZE,
          height: DANGLING_NODE_SIZE,
          borderRadius: '50%',
          border: '2px dashed var(--mantine-color-orange-6)',
          background: 'var(--mantine-color-body)',
          display: 'grid',
          placeItems: 'center',
          cursor: 'grab',
        }}
      >
        <Handle type="target" position={Position.Left} id="tgt" style={{ ...cover, zIndex: 1 }} />
        <Handle type="source" position={Position.Right} id="src" style={{ ...cover, zIndex: 2 }} />
        <Text size="9px" c="orange" fw={700} style={{ pointerEvents: 'none' }}>?</Text>
      </div>
    </Tooltip>
  );
}
