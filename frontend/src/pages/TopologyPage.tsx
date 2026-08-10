import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap, ConnectionMode,
  useNodesState, useEdgesState,
  type Connection, type Node, type ReactFlowInstance,
} from '@xyflow/react';
import { Button, Group, Paper, Select, Stack, Text, Title } from '@mantine/core';
import { IconPlus, IconUsersGroup } from '@tabler/icons-react';
import { useSearchParams } from 'react-router-dom';
import {
  useDeviceTemplates, useDeviceTypes, useLinkTemplates, useLinks, useTags,
  useTopologyGroups, useUpdateDevicePosition, useDeleteDevice, useDeleteLink, useCreateDevice,
  useTopologyDevices,
  useDeleteTopologyGroup, useSetTopologyGroupBox,
} from '../api/hooks';
import { ConnectPortsModal } from './topology/ConnectPortsModal';
import { AttachEndModal } from './topology/AttachEndModal';
import { GroupEditModal } from './topology/GroupEditModal';
import { DeviceGroupModal } from './topology/DeviceGroupModal';
import { groupDepth } from './topology/groups';
import { TopologyActionsContext, type TopologyActions } from './topology/actions';
import { LinkFormModal } from './links/LinkFormModal';
import { DeviceFormModal } from './devices/DeviceFormModal';
import { flattenTagsOrdered } from '../lib/utils';
import { notifyError, notifySuccess } from '../lib/notify';
import type { DeviceOut, LinkOut, TopologyGroupOut } from '../api/types';
import { computeForceLayout, type LayoutNode, type Spring } from './topology/layout';
import { DeviceNode, DEVICE_NODE_WIDTH, DEVICE_NODE_HEIGHT, type DeviceNodeType } from './topology/DeviceNode';
import { GroupNode, GROUP_HEADER_HEIGHT, type GroupNodeType } from './topology/GroupNode';
import { DanglingNode, DANGLING_NODE_SIZE, type DanglingNodeType } from './topology/DanglingNode';
import { FloatingEdge, portText, type FloatingEdgeType } from './topology/FloatingEdge';
import { TopologyGroupsModal } from './topology/TopologyGroupsModal';
import { AppearanceMenu } from './topology/AppearanceMenu';
import {
  TopologyAppearanceContext, loadAppearance, saveAppearance, type TopologyAppearance,
} from './topology/appearance';
import { useCan } from '../auth/permissions';

const nodeTypes = { device: DeviceNode, group: GroupNode, dangling: DanglingNode };
const edgeTypes = { floating: FloatingEdge };
const LINE_DASH: Record<string, string | undefined> = { solid: undefined, dashed: '7 5', dotted: '2 4' };
const GROUP_PADDING = 30;
/** Узел-заглушка свободного конца: `dangling-<id связи>`. Префикс отличает
 * его от узла устройства, id которого — просто число. */
const DANGLING_PREFIX = 'dangling-';
/** Запас, с которым запоминается рамка, посчитанная по содержимому: внутри
 * должно остаться место, чтобы узлы можно было двигать — наружу они больше
 * не выходят. */
const GROUP_SLACK = 90;

type Box = { minX: number; minY: number; maxX: number; maxY: number };

/** Рамка, заданная руками. Пусто — группу ещё ни разу не двигали, и рамка
 * считается по содержимому, как было раньше. */
function storedBox(group: TopologyGroupOut): Box | null {
  if (group.x == null || group.y == null || group.width == null || group.height == null) return null;
  return { minX: group.x, minY: group.y, maxX: group.x + group.width, maxY: group.y + group.height };
}

/** Не дать узлу вылезти за рамку: React Flow подрезает перетаскивание, но
 * не координаты, пришедшие из базы. */
function clampToBox(position: { x: number; y: number }, width: number, height: number) {
  return {
    x: Math.min(Math.max(position.x, 4), Math.max(4, width - DEVICE_NODE_WIDTH - 4)),
    y: Math.min(Math.max(position.y, GROUP_HEADER_HEIGHT), Math.max(GROUP_HEADER_HEIGHT, height - DEVICE_NODE_HEIGHT - 4)),
  };
}
const GROUP_HEADER = GROUP_HEADER_HEIGHT;

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
  // Схема рисует площадку целиком, поэтому берёт устройства со всеми
  // портами отдельным маршрутом: список устройств теперь лёгкий и страничный.
  const { data: devices = EMPTY } = useTopologyDevices();
  const { data: templates = EMPTY } = useDeviceTemplates();
  const { data: types = EMPTY } = useDeviceTypes();
  const { data: linkPage } = useLinks({ limit: 500 });
  const links = linkPage?.items ?? EMPTY;
  const { data: linkTemplates = EMPTY } = useLinkTemplates();
  const { data: tags = EMPTY } = useTags();
  const { data: topologyGroups = EMPTY } = useTopologyGroups();
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [groupsModalOpen, setGroupsModalOpen] = useState(false);
  /** Внешний вид схемы. Настройка личная и живёт в браузере — читается один
   * раз при первом рендере, а не на каждый. */
  const [look, setLook] = useState<TopologyAppearance>(loadAppearance);
  const canEdit = useCan('edit');

  function changeLook(next: TopologyAppearance) {
    setLook(next);
    saveAppearance(next);
  }

  const [nodes, setNodes, onNodesChange] = useNodesState<DeviceNodeType | GroupNodeType | DanglingNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FloatingEdgeType>([]);
  const updatePosition = useUpdateDevicePosition();
  const deleteDevice = useDeleteDevice();
  const deleteLink = useDeleteLink();
  const createDevice = useCreateDevice();
  const deleteGroup = useDeleteTopologyGroup();
  const setGroupBox = useSetTopologyGroupBox();
  const [editingLink, setEditingLink] = useState<LinkOut | null>(null);
  const [editingDevice, setEditingDevice] = useState<DeviceOut | null>(null);
  const [addingDevice, setAddingDevice] = useState(false);
  const [connecting, setConnecting] = useState<{ sourceId: number; targetId: number } | null>(null);
  /** Повисший конец, который перетащили на устройство: осталось выбрать порт. */
  const [attaching, setAttaching] = useState<{ linkId: number; deviceId: number } | null>(null);
  /** Открытая правка группы: сама группа либо создание новой подгруппы. */
  const [editingGroup, setEditingGroup] = useState<{ group: TopologyGroupOut | null; parentId: number | null } | null>(null);
  /** Устройство, которому выбирают группу через панель действий. */
  const [regrouping, setRegrouping] = useState<number | null>(null);
  /** Устройство, на которое пришли по ссылке со своей страницы. Живёт в
   * состоянии, а не только в адресе: иначе подсветку затирало бы первой же
   * перестройкой узлов. */
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const flowRef = useRef<ReactFlowInstance<DeviceNodeType | GroupNodeType | DanglingNodeType, FloatingEdgeType> | null>(null);

  /** Раскладка, которая уже сложилась в этой сессии.
   *
   * Без неё эффект ниже пересчитывал пружинную симуляцию заново на каждое
   * изменение данных — создали связь, поправили имя, и вся схема
   * перестраивалась, а узлы прыгали на новые места. Теперь единожды
   * вычисленное положение считается таким же закреплённым, как сохранённое
   * в базе: двигаются только устройства, которых на схеме ещё не было. */
  const placed = useRef(new Map<number, { x: number; y: number }>());

  /** Абсолютные рамки групп из последней раскладки: по ним определяется, в
   * какую группу человек бросил устройство, перетащив его мышью. */
  const groupBoxes = useRef(new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>());
  /** Группы, которым уже записали посчитанную рамку, — чтобы не писать её
   * повторно на каждую перерисовку. */
  const autoSaved = useRef(new Set<number>());


  const filteredDevices = useMemo(
    () => (tagFilter ? devices.filter((d) => d.tags.some((t) => String(t.id) === tagFilter)) : devices),
    [devices, tagFilter],
  );

  useEffect(() => {
    const ifaceToDevice = new Map<number, number>();
    for (const d of filteredDevices) for (const i of d.interfaces) ifaceToDevice.set(i.id, d.id);
    // Связь с подвешенным концом нарисовать между двумя узлами нельзя —
    // второго узла просто нет. Такие показываются на странице «Связи», где
    // их и подключают заново.
    const visibleLinks = links.filter(
      (l): l is typeof l & { interface_a_id: number; interface_b_id: number } =>
        l.interface_a_id != null && l.interface_b_id != null &&
        ifaceToDevice.has(l.interface_a_id) && ifaceToDevice.has(l.interface_b_id),
    );

    // Устройства с уже сохранённой позицией (перетащили руками в прошлый
    // раз) — "заморожены": не двигаются симуляцией, но отталкивают
    // остальные узлы, чтобы новые не легли поверх них.
    const layoutNodes: LayoutNode[] = filteredDevices.map((d) => {
      // Приоритет: сохранённая в базе позиция, затем уже сложившаяся в этой
      // сессии, и только новые устройства отдаём симуляции.
      const saved = d.topology_x != null && d.topology_y != null
        ? { x: d.topology_x, y: d.topology_y }
        : placed.current.get(d.id);
      return {
        id: String(d.id),
        x: saved?.x ?? 0,
        y: saved?.y ?? 0,
        vx: 0, vy: 0,
        fixed: saved != null,
      };
    });
    const byId = new Map(layoutNodes.map((n) => [n.id, n]));
    const hasNewcomers = layoutNodes.some((n) => !n.fixed);

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

    // Все узлы уже размещены — считать нечего, и главное, нельзя: симуляция
    // сдвинула бы схему под пользователем.
    if (hasNewcomers) computeForceLayout(layoutNodes, springs, 1100, 750);
    for (const n of layoutNodes) placed.current.set(parseInt(n.id, 10), { x: n.x, y: n.y });

    const ifaceLabel = new Map<number, string>();
    const ifaceNumber = new Map<number, number>();
    for (const d of filteredDevices) {
      for (const i of d.interfaces) {
        ifaceLabel.set(i.id, i.label);
        ifaceNumber.set(i.id, i.port_number);
      }
    }

    const deviceNodesById = new Map<number, DeviceNodeType>();
    for (const d of filteredDevices) {
      const template = templates.find((t) => t.id === d.template_id);
      const typeLabel = template ? types.find((t) => t.id === template.device_type_id)?.name ?? '—' : '—';
      const ln = byId.get(String(d.id))!;
      // Порт с подвешенным кабелем тоже занят — иначе счётчик на узле
      // расходился бы с тем, что показывает страница устройства.
      const connected = d.interfaces.filter((i) => i.link_id).length;
      deviceNodesById.set(d.id, {
        id: String(d.id),
        type: 'device',
        selected: String(d.id) === focusedId,
        position: { x: ln.x - DEVICE_NODE_WIDTH / 2, y: ln.y - DEVICE_NODE_HEIGHT / 2 },
        data: {
          code: d.code, subtitle: d.name || template?.name || '—', typeLabel,
          portsTotal: d.interfaces.length, portsConnected: connected,
          color: template?.color ?? null,
        },
      });
    }

    // Рамки групп. Рамка — самостоятельная область на схеме: у неё своё
    // положение и размер, её двигают и растягивают руками, как участок на
    // плане цеха. Под содержимое она не подгоняется — иначе размер задавал
    // бы не человек, а случайное расположение узлов.
    //
    // Исключение — группы, заведённые до появления ручной правки: у них
    // размеров нет, и рамка, как раньше, считается по содержимому, пока её
    // первый раз не подвинут.
    //
    // React Flow требует, чтобы координаты вложенного узла задавались
    // относительно родителя, поэтому сначала считаются абсолютные рамки, и
    // только потом всё пересчитывается в относительные.
    const childGroups = new Map<number | null, typeof topologyGroups>();
    for (const group of topologyGroups) {
      const key = group.parent_id ?? null;
      if (!childGroups.has(key)) childGroups.set(key, []);
      childGroups.get(key)!.push(group);
    }

    const groupBox = new Map<number, Box>();
    const groupDevices = new Map<number, number>();  // сколько устройств внутри, с подгруппами

    const measure = (group: (typeof topologyGroups)[number], visited: Set<number>): Box | null => {
      // Кольцо во вложенности сервер не пропускает, но данные могут прийти
      // и из другой сессии — обрываем на всякий случай.
      if (visited.has(group.id)) return null;
      visited.add(group.id);

      let count = 0;
      const parts: Box[] = [];
      for (const d of filteredDevices) {
        if (d.topology_group_id !== group.id) continue;
        const { x, y } = deviceNodesById.get(d.id)!.position;
        parts.push({ minX: x, minY: y, maxX: x + DEVICE_NODE_WIDTH, maxY: y + DEVICE_NODE_HEIGHT });
        count += 1;
      }
      for (const child of childGroups.get(group.id) ?? []) {
        const box = measure(child, visited);
        if (box) {
          parts.push(box);
          count += groupDevices.get(child.id) ?? 0;
        }
      }
      groupDevices.set(group.id, count);

      const stored = storedBox(group);
      if (stored) {
        groupBox.set(group.id, stored);
        return stored;
      }
      // Пустая группа без заданной рамки не рисуется: пустой прямоугольник
      // на схеме только мешает, а сама группа никуда не делась — она в
      // списке групп, и рамка появится, как только в ней что-то окажется.
      if (parts.length === 0) return null;

      const box: Box = {
        minX: Math.min(...parts.map((p) => p.minX)) - GROUP_PADDING,
        minY: Math.min(...parts.map((p) => p.minY)) - GROUP_PADDING - GROUP_HEADER,
        maxX: Math.max(...parts.map((p) => p.maxX)) + GROUP_PADDING,
        maxY: Math.max(...parts.map((p) => p.maxY)) + GROUP_PADDING,
      };
      groupBox.set(group.id, box);
      return box;
    };
    for (const group of childGroups.get(null) ?? []) measure(group, new Set());

    const depthOf = (group: (typeof topologyGroups)[number]) => groupDepth(topologyGroups, group.id);

    const groupNodes: GroupNodeType[] = [];
    for (const group of [...topologyGroups].sort((a, b) => depthOf(a) - depthOf(b))) {
      const box = groupBox.get(group.id);
      if (!box) continue;
      const parentBox = group.parent_id != null ? groupBox.get(group.parent_id) : undefined;
      groupNodes.push({
        id: `group-${group.id}`,
        type: 'group',
        // Родитель уже в списке — он выше по глубине, а React Flow требует
        // объявлять родителя раньше ребёнка.
        parentId: parentBox ? `group-${group.parent_id}` : undefined,
        // Подгруппа не должна уезжать из своего цеха: наружу её не выпускает
        // сам React Flow, а не проверка после отпускания мыши.
        extent: parentBox ? 'parent' : undefined,
        position: parentBox
          ? { x: box.minX - parentBox.minX, y: box.minY - parentBox.minY }
          : { x: box.minX, y: box.minY },
        // Размер задаётся полями узла, а не style: за них берётся ручка
        // изменения размера, и через style она перерисовать рамку не может —
        // style перекрывает то, что она выставляет.
        width: box.maxX - box.minX,
        height: box.maxY - box.minY,
        data: {
          name: group.name,
          color: group.color ?? '#94a3b8',
          depth: depthOf(group),
          deviceCount: groupDevices.get(group.id) ?? 0,
        },
      });
    }

    for (const d of filteredDevices) {
      const box = d.topology_group_id != null ? groupBox.get(d.topology_group_id) : undefined;
      if (!box) continue;
      const node = deviceNodesById.get(d.id)!;
      node.parentId = `group-${d.topology_group_id}`;
      // За рамку своей группы устройство не выходит: React Flow сам не
      // выпускает его при перетаскивании, а положение, доставшееся от
      // прежней раскладки, подрезается здесь.
      node.extent = 'parent';
      node.position = clampToBox(
        { x: node.position.x - box.minX, y: node.position.y - box.minY },
        box.maxX - box.minX, box.maxY - box.minY,
      );
    }

    // Рамки нужны и снаружи эффекта: по ним пересчитываются координаты,
    // когда рамку двигают или растягивают.
    groupBoxes.current = groupBox;

    // Группе, у которой размеров ещё нет, посчитанная рамка запоминается —
    // один раз. Дальше она живёт своей жизнью: её двигают и растягивают, а
    // содержимое внутри неё уже не может её распирать. Заодно рамка сразу
    // берётся с запасом, чтобы устройствам было куда двигаться: за её
    // границу они больше не выходят.
    for (const group of topologyGroups) {
      const box = groupBox.get(group.id);
      if (!box || storedBox(group) || autoSaved.current.has(group.id)) continue;
      autoSaved.current.add(group.id);
      setGroupBox.mutate({
        id: group.id,
        body: {
          x: box.minX, y: box.minY,
          width: (box.maxX - box.minX) + GROUP_SLACK,
          height: (box.maxY - box.minY) + GROUP_SLACK,
        },
      });
    }

    // Подвешенные кабели: второй конец рисуется заглушкой рядом с живым
    // устройством. Иначе снятая сетевая карта просто стирала кабель со
    // схемы, хотя физически он остался проложен.
    const danglingNodes: DanglingNodeType[] = [];
    const danglingEdges: FloatingEdgeType[] = [];
    // Сколько подвешенных кабелей уже отрисовано у этого устройства —
    // чтобы вторая и третья заглушки не легли на первую.
    const danglingPerDevice = new Map<number, number>();
    for (const link of links) {
      const liveEnd = link.interface_a_id ?? link.interface_b_id;
      const emptyEnd = link.interface_a_id == null || link.interface_b_id == null;
      if (!emptyEnd || liveEnd == null) continue;

      const deviceId = ifaceToDevice.get(liveEnd);
      const deviceNode = deviceId != null ? deviceNodesById.get(deviceId) : undefined;
      if (!deviceNode) continue;

      const stubId = `${DANGLING_PREFIX}${link.id}`;
      const index = danglingPerDevice.get(deviceId!) ?? 0;
      danglingPerDevice.set(deviceId!, index + 1);
      danglingNodes.push({
        id: stubId,
        type: 'dangling',
        // Под устройством, а не сбоку: по бокам стоят соседи, с которыми
        // оно связано, и заглушка наезжала бы на них. Каждая следующая —
        // ниже предыдущей.
        position: {
          x: deviceNode.position.x + DEVICE_NODE_WIDTH / 2 - DANGLING_NODE_SIZE / 2,
          y: deviceNode.position.y + DEVICE_NODE_HEIGHT + 46 + index * 30,
        },
        parentId: deviceNode.parentId,
        data: {
          fromLabel: `${deviceNode.data.code} · ${portText(ifaceNumber.get(liveEnd) ?? null, ifaceLabel.get(liveEnd) ?? '', true)}`.trim(),
        },
        selectable: false,
        // Перетаскивание самой заглушки выключено: тянут за неё кабель, а
        // не двигают её по схеме — иначе жест был бы двусмысленным.
        draggable: false,
      });
      danglingEdges.push({
        id: String(link.id),
        source: String(deviceId),
        target: stubId,
        type: 'floating',
        data: {
          sourceNumber: ifaceNumber.get(liveEnd) ?? null,
          sourceLabel: ifaceLabel.get(liveEnd) ?? '',
          // У свободного конца порта нет — вместо номера так и написано.
          targetNumber: null,
          targetLabel: 'не подключён',
          color: 'var(--mantine-color-orange-6)',
          dashArray: '4 4',
          confirmed: link.confirmed,
        },
      });
    }

    const rfNodes: (DeviceNodeType | GroupNodeType | DanglingNodeType)[] = [
      ...groupNodes, ...deviceNodesById.values(), ...danglingNodes,
    ];

    const rfEdges: FloatingEdgeType[] = visibleLinks.map((l) => {
      const lt = l.template_id ? linkTemplates.find((t) => t.id === l.template_id) : null;
      return {
        id: String(l.id),
        source: String(ifaceToDevice.get(l.interface_a_id)),
        target: String(ifaceToDevice.get(l.interface_b_id)),
        type: 'floating',
        data: {
          sourceNumber: ifaceNumber.get(l.interface_a_id) ?? null,
          sourceLabel: ifaceLabel.get(l.interface_a_id) ?? '',
          targetNumber: ifaceNumber.get(l.interface_b_id) ?? null,
          targetLabel: ifaceLabel.get(l.interface_b_id) ?? '',
          color: lt?.color ?? '#9aa1ab',
          dashArray: LINE_DASH[lt?.line_style ?? 'solid'],
          confirmed: l.confirmed,
        },
      };
    });

    // Выделение переносится на пересобранные узлы. Узлы строятся заново на
    // каждое изменение данных, и без этого панель действий закрывалась бы
    // сама — достаточно кому-то поправить соседнее устройство.
    setNodes((previous) => {
      const selected = new Set(previous.filter((n) => n.selected).map((n) => n.id));
      return rfNodes.map((node) => (selected.has(node.id) ? { ...node, selected: true } : node));
    });
    setEdges([...rfEdges, ...danglingEdges]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredDevices, links, linkTemplates, templates, types, topologyGroups, focusedId]);

  /** Кабель тянут между устройствами, а связь в модели — между портами,
   * поэтому после отпускания спрашиваем, какие именно порты соединить.
   *
   * Отдельный случай — заглушка свободного конца: её тоже можно потянуть на
   * устройство, но новая связь при этом не создаётся, у существующей
   * дотыкается второй конец. */
  const handleConnect = useCallback((connection: Connection) => {
    const ends = [connection.source, connection.target];
    const stub = ends.find((id) => id.startsWith(DANGLING_PREFIX));
    if (stub) {
      const device = ends.find((id) => id !== stub);
      const deviceId = device ? parseInt(device, 10) : NaN;
      if (!Number.isFinite(deviceId)) return;
      setAttaching({ linkId: parseInt(stub.slice(DANGLING_PREFIX.length), 10), deviceId });
      return;
    }

    const sourceId = parseInt(connection.source, 10);
    const targetId = parseInt(connection.target, 10);
    if (!sourceId || !targetId || sourceId === targetId) return;
    setConnecting({ sourceId, targetId });
  }, []);

  /** Действия панели над узлом. Копия — новое устройство по той же модели:
   * код ему выдаётся свой, порты копируются из модели, а положение берётся
   * рядом с оригиналом, чтобы копию было видно. */
  const actions: TopologyActions = useMemo(() => ({
    edit: (deviceId) => {
      const device = devices.find((d) => d.id === deviceId);
      if (device) setEditingDevice(device);
    },
    copy: (deviceId) => {
      const source = devices.find((d) => d.id === deviceId);
      if (!source) return;
      createDevice.mutate(
        {
          template_id: source.template_id,
          name: source.name,
          location: source.location,
          role: source.role,
          notes: source.notes,
          topology_group_id: source.topology_group_id,
          tag_ids: source.tags.map((t) => t.id),
          // IP и дату установки намеренно не копируем: они у каждой железки
          // свои, а скопированный IP означал бы конфликт адресов.
        },
        {
          onSuccess: (created) => {
            notifySuccess(`Создано устройство ${created.code}`);
            const at = placed.current.get(deviceId);
            if (at) updatePosition.mutate({ id: created.id, body: { x: at.x + 60, y: at.y + 90 } });
          },
          onError: notifyError,
        },
      );
    },
    remove: (deviceId) => {
      const device = devices.find((d) => d.id === deviceId);
      if (!device) return;
      if (!confirm(`Удалить устройство «${device.code}» вместе с портами и связями?`)) return;
      deleteDevice.mutate(deviceId, { onError: notifyError });
    },
    regroup: (deviceId) => setRegrouping(deviceId),

    editGroup: (groupId) => {
      const group = topologyGroups.find((g) => g.id === groupId);
      if (group) setEditingGroup({ group, parentId: null });
    },
    addSubgroup: (groupId) => setEditingGroup({ group: null, parentId: groupId }),
    resizeGroup: (groupId, size) => {
      // Размер приходит в координатах родителя — переводим в общие.
      const group = topologyGroups.find((g) => g.id === groupId);
      const parentBox = group?.parent_id != null ? groupBoxes.current.get(group.parent_id) : undefined;
      setGroupBox.mutate({
        id: groupId,
        body: {
          x: size.x + (parentBox?.minX ?? 0),
          y: size.y + (parentBox?.minY ?? 0),
          width: size.width,
          height: size.height,
        },
      }, { onError: notifyError });
    },
    removeGroup: (groupId) => {
      const group = topologyGroups.find((g) => g.id === groupId);
      if (!group) return;
      if (!confirm(`Удалить группу «${group.name}»? Устройства останутся, подгруппы поднимутся на уровень выше.`)) return;
      deleteGroup.mutate(groupId, {
        onSuccess: () => notifySuccess('Группа удалена'),
        onError: notifyError,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [devices, topologyGroups]);

  /** Переход со страницы устройства: `?device=12` — показать и подсветить. */
  const focusDeviceId = searchParams.get('device');
  useEffect(() => {
    if (!focusDeviceId) return;
    setFocusedId(focusDeviceId);
    // Параметр одноразовый: иначе схему дёргало бы на это устройство при
    // каждом обновлении данных.
    const rest = new URLSearchParams(searchParams);
    rest.delete('device');
    setSearchParams(rest, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusDeviceId]);

  useEffect(() => {
    if (!focusedId || nodes.length === 0) return;
    // Небольшая отсрочка: узлы только что переданы в React Flow пропсами, и
    // в его внутреннем хранилище (откуда fitView берёт размеры) они
    // появляются на следующем кадре.
    const timer = setTimeout(() => {
      const flow = flowRef.current;
      if (flow?.getNode(focusedId)) {
        flow.fitView({ nodes: [{ id: focusedId }], duration: 600, maxZoom: 1.4, padding: 0.6 });
      }
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId, nodes.length]);

  /** Клик по линии — правка связи: шаблон, длина, разъём, удаление. */
  const handleEdgeClick = useCallback((_event: unknown, edge: { id: string }) => {
    const link = links.find((l) => String(l.id) === edge.id);
    if (link) setEditingLink(link);
  }, [links]);

  /**
   * Удаление узла или линии клавишей Delete.
   *
   * React Flow спрашивает разрешение до того, как убрать элемент из своего
   * состояния, — здесь и подтверждаем у человека, и удаляем на сервере.
   * Вернуть false значит «не трогай»: иначе узел исчез бы со схемы, а в базе
   * остался, и вернулся бы при следующем обновлении данных.
   */
  const handleBeforeDelete = useCallback(async ({ nodes: doomedNodes, edges: doomedEdges }: {
    nodes: Node[];
    edges: { id: string }[];
  }) => {
    const devices = doomedNodes.filter((n) => n.type === 'device');
    const groups = doomedNodes.filter((n) => n.type === 'group');
    if (devices.length === 0 && groups.length === 0 && doomedEdges.length === 0) return false;

    const what = [
      devices.length > 0 && `устройств: ${devices.length} (вместе с портами и связями)`,
      groups.length > 0 && `групп: ${groups.length} (устройства останутся)`,
      doomedEdges.length > 0 && `связей: ${doomedEdges.length}`,
    ].filter(Boolean).join(', ');
    if (!confirm(`Удалить ${what}?`)) return false;

    await Promise.all([
      ...devices.map((n) => deleteDevice.mutateAsync(parseInt(n.id, 10))),
      ...groups.map((n) => deleteGroup.mutateAsync(parseInt(n.id.replace('group-', ''), 10))),
      ...doomedEdges.map((e) => deleteLink.mutateAsync(parseInt(e.id, 10))),
    ]).catch(notifyError);
    return true;
  }, [deleteDevice, deleteLink, deleteGroup]);

  /** Новое устройство появляется там, куда человек смотрит, а не за краем
   * экрана: берём центр видимой области. */
  function placeNewDevice(deviceId: number) {
    const flow = flowRef.current;
    if (!flow) return;
    const { x, y } = flow.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    updatePosition.mutate({ id: deviceId, body: { x, y } });
  }

  /** Абсолютное положение узла: у вложенных оно задано относительно рамки. */
  function absolutePosition(node: Node) {
    if (!node.parentId) return { ...node.position };
    const parentBox = groupBoxes.current.get(parseInt(node.parentId.replace('group-', ''), 10));
    if (!parentBox) return { ...node.position };
    return { x: node.position.x + parentBox.minX, y: node.position.y + parentBox.minY };
  }

  /** Все группы внутри этой, на любую глубину. */
  const descendantGroups = useCallback((groupId: number): number[] => {
    const direct = topologyGroups.filter((g) => g.parent_id === groupId).map((g) => g.id);
    return direct.flatMap((id) => [id, ...descendantGroups(id)]);
  }, [topologyGroups]);

  function handleNodeDragStop(_event: unknown, node: Node) {
    if (node.type === 'group') {
      const groupId = parseInt(node.id.replace('group-', ''), 10);
      const box = groupBoxes.current.get(groupId);
      if (!box) return;
      const moved = absolutePosition(node);
      const dx = moved.x - box.minX;
      const dy = moved.y - box.minY;
      if (dx === 0 && dy === 0) return;

      setGroupBox.mutate({
        id: groupId,
        body: { x: moved.x, y: moved.y, width: box.maxX - box.minX, height: box.maxY - box.minY },
      });

      // Содержимое едет вместе с рамкой. На экране это уже произошло —
      // React Flow двигает вложенные узлы за родителем, — но в базе
      // положение хранится абсолютным, и его нужно сдвинуть тоже, иначе
      // после обновления страницы устройства останутся на прежнем месте.
      const inside = new Set([groupId, ...descendantGroups(groupId)]);
      for (const nested of descendantGroups(groupId)) {
        const nestedBox = groupBoxes.current.get(nested);
        const group = topologyGroups.find((g) => g.id === nested);
        // У рамки, которая считается по содержимому, сдвигать нечего:
        // она пересчитается сама по новым координатам устройств.
        if (!nestedBox || !group || group.x == null) continue;
        setGroupBox.mutate({
          id: nested,
          body: {
            x: nestedBox.minX + dx, y: nestedBox.minY + dy,
            width: nestedBox.maxX - nestedBox.minX, height: nestedBox.maxY - nestedBox.minY,
          },
        });
      }
      for (const device of devices) {
        if (device.topology_group_id == null || !inside.has(device.topology_group_id)) continue;
        const at = placed.current.get(device.id);
        if (!at) continue;
        updatePosition.mutate({ id: device.id, body: { x: at.x + dx, y: at.y + dy } });
      }
      return;
    }

    if (node.type !== 'device') return;
    // Позиция вложенного узла задана относительно рамки — возвращаем её в
    // общие координаты схемы, в которых она и хранится в базе.
    const { x, y } = absolutePosition(node);
    updatePosition.mutate({
      id: parseInt(node.id, 10),
      body: { x: x + DEVICE_NODE_WIDTH / 2, y: y + DEVICE_NODE_HEIGHT / 2 },
    });
  }

  return (
    <TopologyActionsContext.Provider value={canEdit ? actions : null}>
    <TopologyAppearanceContext.Provider value={look}>
    <Stack h="100%" gap="sm">
      <Group justify="space-between">
        <Title order={2}>Схема связей</Title>
        <Group>
          <Select
            placeholder="Все теги" clearable w={200}
            data={flattenTagsOrdered(tags).map(({ tag, depth }) => ({ value: String(tag.id), label: `${'—'.repeat(depth)} ${tag.name}` }))}
            value={tagFilter} onChange={setTagFilter}
          />
          {canEdit && (
            <Button variant="light" leftSection={<IconUsersGroup size={16} />} onClick={() => setGroupsModalOpen(true)}>
              Группы
            </Button>
          )}
          {/* Настройки вида — не правка данных: смотрящему они нужны так же,
              как и всем, и 403 за ними не стоит. */}
          <AppearanceMenu value={look} onChange={changeLook} />
          {/* Проба другой библиотеки рисования — отдельным окном, чтобы
              сравнить, не трогая рабочую схему. */}
          <Button
            variant="subtle" size="compact-sm" color="gray"
            onClick={() => window.open(`/topology-joint?site=${searchParams.get('site') ?? ''}`, '_blank', 'noopener')}
          >
            JointJS
          </Button>
          {canEdit && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setAddingDevice(true)}>
              Устройство
            </Button>
          )}
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
            // Смотрящему схема доступна целиком, но только смотреть: узел не
            // сдвинуть (положение сохраняется на сервере), кабель не
            // протянуть, Delete ничего не удаляет.
            nodesDraggable={canEdit}
            nodesConnectable={canEdit}
            onConnect={handleConnect}
            onEdgeClick={handleEdgeClick}
            onBeforeDelete={handleBeforeDelete}
            // По умолчанию React Flow слушает только Backspace — на клавише
            // Delete ничего не происходило, хотя подсказка обещала обратное.
            deleteKeyCode={canEdit ? ['Delete', 'Backspace'] : null}
            onInit={(instance) => { flowRef.current = instance; }}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            // Кабель тянут «к устройству», а не «в точку на его краю»:
            // радиус захвата примерно с половину узла, поэтому достаточно
            // отпустить мышь над нужным узлом. loose — потому что связь
            // симметрична, и какой конец считать источником, неважно.
            connectionMode={ConnectionMode.Loose}
            connectionRadius={95}
            fitView
            minZoom={0.2}
            maxZoom={3}
          >
            {look.background !== 'none' && (
              <Background variant={look.background as BackgroundVariant} />
            )}
            <Controls />
            {look.minimap && <MiniMap pannable zoomable />}
          </ReactFlow>
        )}
      </Paper>
      <Text c="dimmed" size="sm">
        Соединить устройства — потяните за точку на краю узла до другого узла и выберите порты. Клик по узлу
        открывает панель: править, копировать, в группу, удалить; клик по рамке группы — свою: правка, подгруппа,
        удаление. Рамку группы двигают и растягивают мышью, а её состав меняется только явно — узел, вынесенный
        за рамку, группу не покидает и за её границу не выходит. Клик по линии открывает правку связи. Оранжевый кружок
        с «?» — свободный конец кабеля: потяните его на устройство, чтобы воткнуть в порт. Клавиша Delete
        удаляет выделенный узел или линию. Узлы можно перетаскивать, позиция сохраняется. Цвет узла берётся из
        модели техники, цвет линии — из шаблона связи, цвет рамки — из группы (кнопка «Группы»). Кнопка «Вид»
        настраивает оформление схемы: контур и заливку рамок, подписи, толщину линий, фон — настройки личные и
        запоминаются в этом браузере.
      </Text>
      {groupsModalOpen && <TopologyGroupsModal onClose={() => setGroupsModalOpen(false)} />}
      {editingLink && (
        <LinkFormModal link={editingLink} templates={linkTemplates} onClose={() => setEditingLink(null)} />
      )}
      {addingDevice && (
        <DeviceFormModal
          device={null}
          onCreated={placeNewDevice}
          onClose={() => setAddingDevice(false)}
        />
      )}
      {connecting && (
        <ConnectPortsModal
          sourceId={connecting.sourceId}
          targetId={connecting.targetId}
          onClose={() => setConnecting(null)}
        />
      )}
      {attaching && (
        <AttachEndModal
          linkId={attaching.linkId}
          deviceId={attaching.deviceId}
          onClose={() => setAttaching(null)}
        />
      )}
      {editingDevice && (
        <DeviceFormModal device={editingDevice} onClose={() => setEditingDevice(null)} />
      )}
      {editingGroup && (
        <GroupEditModal
          group={editingGroup.group}
          parentId={editingGroup.parentId}
          onClose={() => setEditingGroup(null)}
        />
      )}
      {regrouping != null && (
        <DeviceGroupModal deviceId={regrouping} onClose={() => setRegrouping(null)} />
      )}
    </Stack>
    </TopologyAppearanceContext.Provider>
    </TopologyActionsContext.Provider>
  );
}
