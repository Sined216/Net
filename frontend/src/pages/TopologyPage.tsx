import { useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState, type Node } from '@xyflow/react';
import { Button, Group, Paper, Select, Stack, Text, Title } from '@mantine/core';
import { IconUsersGroup } from '@tabler/icons-react';
import {
  useDeviceTemplates, useDeviceTypes, useDevices, useLinkTemplates, useLinks, useTags,
  useTopologyGroups, useUpdateDevicePosition,
} from '../api/hooks';
import { flattenTagsOrdered } from '../lib/utils';
import { computeForceLayout, type LayoutNode, type Spring } from './topology/layout';
import { DeviceNode, DEVICE_NODE_WIDTH, DEVICE_NODE_HEIGHT, type DeviceNodeType } from './topology/DeviceNode';
import { GroupNode, type GroupNodeType } from './topology/GroupNode';
import { FloatingEdge, type FloatingEdgeType } from './topology/FloatingEdge';
import { TopologyGroupsModal } from './topology/TopologyGroupsModal';

const nodeTypes = { device: DeviceNode, group: GroupNode };
const edgeTypes = { floating: FloatingEdge };
const LINE_DASH: Record<string, string | undefined> = { solid: undefined, dashed: '7 5', dotted: '2 4' };
const GROUP_PADDING = 30;
const GROUP_HEADER = 26;

/** Общая заглушка для ещё не загруженных запросов.
 *
 * Писать `const { data = [] } = useQuery(...)` здесь нельзя: пока запрос не
 * ответил, `data` равно undefined, и литерал `[]` создаёт НОВЫЙ массив на
 * каждый рендер. Эффект ниже сравнивает зависимости по ссылке, поэтому
 * считал данные изменившимися, вызывал setNodes, получал новый рендер — и
 * так по кругу, пока React не падал с «Maximum update depth exceeded»
 * (ошибка #185) и не оставлял пустую страницу. Ловилось не всегда: если все
 * шесть запросов успевали ответить достаточно быстро, цикл обрывался сам.
 *
 * Ссылка на константу стабильна между рендерами, поэтому эффект срабатывает
 * только на настоящее изменение данных. `never[]` присваивается массиву
 * любого типа, так что одной константы хватает на все запросы. */
const EMPTY: never[] = [];

export function TopologyPage() {
  const { data: devices = EMPTY } = useDevices();
  const { data: templates = EMPTY } = useDeviceTemplates();
  const { data: types = EMPTY } = useDeviceTypes();
  const { data: links = EMPTY } = useLinks();
  const { data: linkTemplates = EMPTY } = useLinkTemplates();
  const { data: tags = EMPTY } = useTags();
  const { data: topologyGroups = EMPTY } = useTopologyGroups();
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [groupsModalOpen, setGroupsModalOpen] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState<DeviceNodeType | GroupNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FloatingEdgeType>([]);
  const updatePosition = useUpdateDevicePosition();

  const filteredDevices = useMemo(
    () => (tagFilter ? devices.filter((d) => d.tags.some((t) => String(t.id) === tagFilter)) : devices),
    [devices, tagFilter],
  );

  useEffect(() => {
    const ifaceToDevice = new Map<number, number>();
    for (const d of filteredDevices) for (const i of d.interfaces) ifaceToDevice.set(i.id, d.id);
    const visibleLinks = links.filter((l) => ifaceToDevice.has(l.interface_a_id) && ifaceToDevice.has(l.interface_b_id));

    // Устройства с уже сохранённой позицией (перетащили руками в прошлый
    // раз) — "заморожены": не двигаются симуляцией, но отталкивают
    // остальные узлы, чтобы новые не легли поверх них.
    const layoutNodes: LayoutNode[] = filteredDevices.map((d) => ({
      id: String(d.id),
      x: d.topology_x ?? 0,
      y: d.topology_y ?? 0,
      vx: 0, vy: 0,
      fixed: d.topology_x != null && d.topology_y != null,
    }));
    const byId = new Map(layoutNodes.map((n) => [n.id, n]));

    const springs: Spring[] = [];
    for (const l of visibleLinks) {
      const a = byId.get(String(ifaceToDevice.get(l.interface_a_id)));
      const b = byId.get(String(ifaceToDevice.get(l.interface_b_id)));
      if (a && b && a !== b) springs.push({ a, b, idealLen: 220, strength: 0.02 });
    }
    // Мягкое притяжение внутри группы — кластер складывается сам, без
    // отдельного прохода в локальных координатах (см. комментарий в layout.ts).
    const byGroup = new Map<number, LayoutNode[]>();
    for (const d of filteredDevices) {
      if (d.topology_group_id == null) continue;
      const ln = byId.get(String(d.id));
      if (!ln) continue;
      if (!byGroup.has(d.topology_group_id)) byGroup.set(d.topology_group_id, []);
      byGroup.get(d.topology_group_id)!.push(ln);
    }
    for (const members of byGroup.values()) {
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          springs.push({ a: members[i], b: members[j], idealLen: 90, strength: 0.01 });
        }
      }
    }

    computeForceLayout(layoutNodes, springs, 1100, 750);

    const ifaceLabel = new Map<number, string>();
    for (const d of filteredDevices) for (const i of d.interfaces) ifaceLabel.set(i.id, i.label);

    const deviceNodesById = new Map<number, DeviceNodeType>();
    for (const d of filteredDevices) {
      const template = templates.find((t) => t.id === d.template_id);
      const typeLabel = template ? types.find((t) => t.id === template.device_type_id)?.name ?? '—' : '—';
      const ln = byId.get(String(d.id))!;
      const connected = d.interfaces.filter((i) => i.connected_to).length;
      deviceNodesById.set(d.id, {
        id: String(d.id),
        type: 'device',
        position: { x: ln.x - DEVICE_NODE_WIDTH / 2, y: ln.y - DEVICE_NODE_HEIGHT / 2 },
        data: {
          code: d.code, subtitle: d.name || template?.name || '—', typeLabel,
          portsTotal: d.interfaces.length, portsConnected: connected,
        },
      });
    }

    // Рамки групп — постфактум вокруг уже сложившегося кластера, координаты
    // детей пересчитываются в относительные (требование React Flow для
    // parentId), а сохранённая позиция при этом остаётся абсолютной.
    const groupNodes: GroupNodeType[] = [];
    for (const group of topologyGroups) {
      const members = filteredDevices.filter((d) => d.topology_group_id === group.id);
      if (members.length === 0) continue;
      const positions = members.map((d) => deviceNodesById.get(d.id)!.position);
      const minX = Math.min(...positions.map((p) => p.x)) - GROUP_PADDING;
      const minY = Math.min(...positions.map((p) => p.y)) - GROUP_PADDING - GROUP_HEADER;
      const maxX = Math.max(...positions.map((p) => p.x + DEVICE_NODE_WIDTH)) + GROUP_PADDING;
      const maxY = Math.max(...positions.map((p) => p.y + DEVICE_NODE_HEIGHT)) + GROUP_PADDING;
      const groupNodeId = `group-${group.id}`;
      groupNodes.push({
        id: groupNodeId,
        type: 'group',
        position: { x: minX, y: minY },
        style: { width: maxX - minX, height: maxY - minY },
        data: { name: group.name, color: group.color ?? '#94a3b8' },
        selectable: false,
        draggable: false,
      });
      for (const d of members) {
        const node = deviceNodesById.get(d.id)!;
        node.parentId = groupNodeId;
        node.position = { x: node.position.x - minX, y: node.position.y - minY };
      }
    }

    const rfNodes: (DeviceNodeType | GroupNodeType)[] = [...groupNodes, ...deviceNodesById.values()];

    const rfEdges: FloatingEdgeType[] = visibleLinks.map((l) => {
      const lt = l.template_id ? linkTemplates.find((t) => t.id === l.template_id) : null;
      return {
        id: String(l.id),
        source: String(ifaceToDevice.get(l.interface_a_id)),
        target: String(ifaceToDevice.get(l.interface_b_id)),
        type: 'floating',
        data: {
          sourceLabel: ifaceLabel.get(l.interface_a_id) ?? '',
          targetLabel: ifaceLabel.get(l.interface_b_id) ?? '',
          color: lt?.color ?? '#9aa1ab',
          dashArray: LINE_DASH[lt?.line_style ?? 'solid'],
          confirmed: l.confirmed,
        },
      };
    });

    setNodes(rfNodes);
    setEdges(rfEdges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredDevices, links, linkTemplates, templates, types, topologyGroups]);

  function handleNodeDragStop(_event: unknown, node: Node) {
    if (node.type !== 'device') return;
    let x = node.position.x, y = node.position.y;
    if (node.parentId) {
      const parent = nodes.find((n) => n.id === node.parentId);
      if (parent) { x += parent.position.x; y += parent.position.y; }
    }
    updatePosition.mutate({ id: parseInt(node.id, 10), body: { x: x + DEVICE_NODE_WIDTH / 2, y: y + DEVICE_NODE_HEIGHT / 2 } });
  }

  return (
    <Stack h="100%" gap="sm">
      <Group justify="space-between">
        <Title order={2}>Схема связей</Title>
        <Group>
          <Select
            placeholder="Все теги" clearable w={200}
            data={flattenTagsOrdered(tags).map(({ tag, depth }) => ({ value: String(tag.id), label: `${'—'.repeat(depth)} ${tag.name}` }))}
            value={tagFilter} onChange={setTagFilter}
          />
          <Button variant="light" leftSection={<IconUsersGroup size={16} />} onClick={() => setGroupsModalOpen(true)}>
            Группы
          </Button>
        </Group>
      </Group>
      <Paper withBorder style={{ height: 640 }}>
        {nodes.length === 0 ? (
          <Group h="100%" justify="center"><Text c="dimmed">Нет устройств для отображения</Text></Group>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={handleNodeDragStop}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            minZoom={0.2}
            maxZoom={3}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        )}
      </Paper>
      <Text c="dimmed" size="sm">
        Узлы можно перетаскивать — позиция сохраняется, при следующем открытии не пересчитывается. Подписи на
        связях — с какого порта на какой; цвет и стиль линии — из шаблона связи. Пунктирная рамка — группа
        (задаётся отдельно от тегов, кнопка «Группы»).
      </Text>
      {groupsModalOpen && <TopologyGroupsModal onClose={() => setGroupsModalOpen(false)} />}
    </Stack>
  );
}
