import { Handle, NodeToolbar, Position, type NodeProps, type Node } from '@xyflow/react';
import { ActionIcon, Group, Paper, Text, Tooltip } from '@mantine/core';
import { IconCopy, IconPencil, IconTrash } from '@tabler/icons-react';
import { useTopologyActions } from './actions';

export interface DeviceNodeData extends Record<string, unknown> {
  code: string;
  subtitle: string;
  typeLabel: string;
  portsTotal: number;
  portsConnected: number;
  /** Цвет модели техники (device_templates.color). Пусто — нейтральный узел. */
  color?: string | null;
}

export type DeviceNodeType = Node<DeviceNodeData, 'device'>;

export const DEVICE_NODE_WIDTH = 178;
export const DEVICE_NODE_HEIGHT = 62;

const NEUTRAL = 'var(--mantine-color-dimmed)';

/** Узел устройства в духе Turbo Flow: тёмная карточка с подсвеченной рамкой,
 * цвет которой берётся из модели техники — все коммутаторы одного цвета, все
 * станки другого.
 *
 * Градиентную рамку из оригинального примера намеренно не делаем анимированной:
 * это CSS-анимация на каждом узле, и на нескольких сотнях устройств схема
 * начинает подтормаживать на ровном месте. Статический градиент даёт тот же
 * вид без этой цены.
 *
 * Раньше тут был ряд квадратиков — по одному на порт — и связи целились точно
 * в свой квадратик; с плавающими рёбрами (см. FloatingEdge) точка касания
 * считается по границе прямоугольника, поэтому ряд квадратиков и узел
 * разъезжались. Взамен — счётчик "занято/всего", а какие именно порты
 * соединены, видно из подписей на самих рёбрах.
 */
export function DeviceNode({ id, data, selected }: NodeProps<DeviceNodeType>) {
  const accent = data.color || NEUTRAL;
  const connected = data.portsConnected > 0;
  const actions = useTopologyActions();
  const deviceId = parseInt(id, 10);

  return (
    <div
      className="topology-device-node"
      style={{
        width: DEVICE_NODE_WIDTH,
        minHeight: DEVICE_NODE_HEIGHT,
        borderRadius: 10,
        // Рамка-градиент: подложка красится, содержимое лежит поверх на фоне
        // страницы — так рамка получается цветной без второго элемента.
        padding: 1.5,
        background: `linear-gradient(140deg, ${accent}, color-mix(in srgb, ${accent} 25%, transparent))`,
        boxShadow: `0 1px 10px color-mix(in srgb, ${accent} 22%, transparent)`,
      }}
    >
      {/* Панель действий над выделенным узлом: править, скопировать,
          удалить — не уходя со схемы на страницу устройства. */}
      {actions && (
        <NodeToolbar isVisible={selected} position={Position.Top} offset={8}>
          <Paper withBorder shadow="sm" p={2} radius="md">
            <Group gap={2} wrap="nowrap">
              <Tooltip label="Редактировать">
                <ActionIcon variant="subtle" size="sm" onClick={() => actions.edit(deviceId)}>
                  <IconPencil size={15} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Копировать — новое устройство по той же модели">
                <ActionIcon variant="subtle" size="sm" onClick={() => actions.copy(deviceId)}>
                  <IconCopy size={15} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Удалить">
                <ActionIcon variant="subtle" size="sm" color="red" onClick={() => actions.remove(deviceId)}>
                  <IconTrash size={15} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Paper>
        </NodeToolbar>
      )}

      {/* Точки подключения: за них тянут кабель мышкой. Раньше обе были
          скрыты и не принимали события — связь можно было создать только из
          карточки устройства. Видимы при наведении, чтобы не рябить на
          схеме из сотен узлов. */}
      <Handle
        type="source" position={Position.Right} id="src"
        style={{ width: 9, height: 9, background: accent, border: '2px solid var(--mantine-color-body)' }}
      />
      <Handle
        type="target" position={Position.Left} id="tgt"
        style={{ width: 9, height: 9, background: accent, border: '2px solid var(--mantine-color-body)' }}
      />
      {/* Пока узел выделен, над ним висит панель действий — подсказка
          перекрыла бы её собой. */}
      <Tooltip label={`${data.code} — ${data.subtitle} (${data.typeLabel})`} disabled={selected}>
        <div
          style={{
            borderRadius: 8.5,
            background: 'var(--mantine-color-body)',
            padding: '7px 9px',
            height: '100%',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: accent,
              }}
            />
            <Text size="sm" fw={700} truncate style={{ flex: 1, minWidth: 0 }}>
              {data.code}
            </Text>
            <Text size="xs" c={connected ? 'teal' : 'dimmed'} fw={600} style={{ flexShrink: 0 }}>
              {data.portsConnected}/{data.portsTotal}
            </Text>
          </div>
          <Text size="xs" c="dimmed" truncate mt={2}>
            {data.subtitle}
          </Text>
        </div>
      </Tooltip>
    </div>
  );
}
