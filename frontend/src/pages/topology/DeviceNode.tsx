import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Badge, Text, Tooltip } from '@mantine/core';

export interface DeviceNodeData extends Record<string, unknown> {
  code: string;
  subtitle: string;
  typeLabel: string;
  portsTotal: number;
  portsConnected: number;
}

export type DeviceNodeType = Node<DeviceNodeData, 'device'>;

export const DEVICE_NODE_WIDTH = 170;
export const DEVICE_NODE_HEIGHT = 56;

/** Узел устройства. Раньше тут был ряд квадратиков — по одному на порт — и
 * связи целились точно в свой квадратик; с плавающими рёбрами (см.
 * FloatingEdge) точка касания линии считается по границе прямоугольника,
 * а не по конкретному порту, поэтому ряд квадратиков и узел разъезжались.
 * Взамен — компактный бейдж "занято/всего", какие именно порты соединены
 * видно из подписей на самих рёбрах. */
export function DeviceNode({ data }: NodeProps<DeviceNodeType>) {
  return (
    <div
      style={{
        width: DEVICE_NODE_WIDTH,
        minHeight: DEVICE_NODE_HEIGHT,
        border: '1.5px solid var(--mantine-color-default-border)',
        borderRadius: 8,
        background: 'var(--mantine-color-body)',
        padding: '6px 8px',
      }}
    >
      <Handle type="source" position={Position.Top} id="src" style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="target" position={Position.Top} id="tgt" style={{ opacity: 0, pointerEvents: 'none' }} />
      <Tooltip label={`${data.code} — ${data.subtitle} (${data.typeLabel})`}>
        <div>
          <Text size="sm" fw={700} truncate>{data.code}</Text>
          <Text size="xs" c="dimmed" truncate>{data.subtitle}</Text>
          <Badge mt={4} size="xs" variant="light" color={data.portsConnected > 0 ? 'teal' : 'gray'}>
            {data.portsConnected}/{data.portsTotal} порт.
          </Badge>
        </div>
      </Tooltip>
    </div>
  );
}
