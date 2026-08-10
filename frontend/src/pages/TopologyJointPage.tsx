import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Group, Paper, SegmentedControl, Select, Stack, Text, Title } from '@mantine/core';
import { IconFocusCentered, IconPlus, IconUsersGroup } from '@tabler/icons-react';
import { useSearchParams } from 'react-router-dom';
import { dia, highlighters, shapes } from '@joint/core';
import {
  useCreateDevice, useDeleteDevice, useDeleteTopologyGroup, useDeviceTemplates,
  useDeviceTypes, useLinkTemplates, useLinks, useSetTopologyGroupBox, useTags, useTopologyDevices,
  useTopologyGroups, useUpdateDevicePosition,
} from '../api/hooks';
import { ConnectPortsModal } from './topology/ConnectPortsModal';
import { AttachEndModal } from './topology/AttachEndModal';
import { GroupEditModal } from './topology/GroupEditModal';
import { DeviceGroupModal } from './topology/DeviceGroupModal';
import { TopologyGroupsModal } from './topology/TopologyGroupsModal';
import { LinkFormModal } from './links/LinkFormModal';
import { DeviceFormModal } from './devices/DeviceFormModal';
import { groupDepth } from './topology/groups';
import { computeForceLayout, type LayoutNode, type Spring } from './topology/layout';
import { AppearanceMenu } from './topology/AppearanceMenu';
import { loadAppearance, saveAppearance, tint, type TopologyAppearance } from './topology/appearance';
import {
  DeviceShape, GroupShape, StubShape, GROUP_MIN, NEUTRAL, NODE, STUB_SIZE, withAlpha,
} from './topology/joint/shapes';
import { deviceTools, groupTools } from './topology/joint/tools';
import { flattenTagsOrdered } from '../lib/utils';
import { notifyError, notifySuccess } from '../lib/notify';
import { useCan } from '../auth/permissions';
import type { DeviceOut, LinkOut, TopologyGroupOut } from '../api/types';

/** Схема связей на JointJS — второй вариант той же схемы.
 *
 * Умеет то же, что и основная на React Flow: завести и править устройство,
 * протянуть кабель, подключить повисший конец, разложить по группам,
 * подвинуть и растянуть рамку, удалить. Отличается разводкой линий: JointJS
 * сам обводит кабели вокруг узлов, и это главное, ради чего вариант
 * существует.
 *
 * Обе схемы читают одни и те же данные и пишут через те же маршруты, так
 * что переключаться между ними можно в любой момент — и выбрать ту, которая
 * приживётся.
 */

const EMPTY: never[] = [];
/** Запас у рамки, посчитанной по содержимому: внутри должно остаться место,
 * чтобы узлы можно было двигать. */
const GROUP_SLACK = 90;
const GROUP_PADDING = 34;

type Box = { x: number; y: number; width: number; height: number };
type Selection = { kind: 'device' | 'group'; id: number } | null;

/** Что панель действий умеет делать с узлом и с рамкой. */
interface JointActions {
  edit: (deviceId: number) => void;
  copy: (deviceId: number) => void;
  regroup: (deviceId: number) => void;
  remove: (deviceId: number) => void;
  editGroup: (groupId: number) => void;
  addSubgroup: (groupId: number) => void;
  removeGroup: (groupId: number) => void;
}

function storedBox(group: TopologyGroupOut): Box | null {
  if (group.x == null || group.y == null || group.width == null || group.height == null) return null;
  return { x: group.x, y: group.y, width: group.width, height: group.height };
}

export function TopologyJointPage() {
  const { data: devices = EMPTY } = useTopologyDevices();
  const { data: linkPage } = useLinks({ limit: 500 });
  const { data: templates = EMPTY } = useDeviceTemplates();
  const { data: types = EMPTY } = useDeviceTypes();
  const { data: linkTemplates = EMPTY } = useLinkTemplates();
  const { data: tags = EMPTY } = useTags();
  const { data: groups = EMPTY } = useTopologyGroups();
  const links = linkPage?.items ?? EMPTY;

  const canEdit = useCan('edit');
  const updatePosition = useUpdateDevicePosition();
  const deleteDevice = useDeleteDevice();
  const createDevice = useCreateDevice();
  const deleteGroup = useDeleteTopologyGroup();
  const setGroupBox = useSetTopologyGroupBox();

  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [look, setLook] = useState<TopologyAppearance>(loadAppearance);
  const [router, setRouter] = useState<'orthogonal' | 'straight'>('orthogonal');
  const [addingDevice, setAddingDevice] = useState(false);
  const [editingDevice, setEditingDevice] = useState<DeviceOut | null>(null);
  const [editingLink, setEditingLink] = useState<LinkOut | null>(null);
  const [connecting, setConnecting] = useState<{ sourceId: number; targetId: number } | null>(null);
  const [attaching, setAttaching] = useState<{ linkId: number; deviceId: number } | null>(null);
  const [editingGroup, setEditingGroup] = useState<{ group: TopologyGroupOut | null; parentId: number | null } | null>(null);
  const [regrouping, setRegrouping] = useState<number | null>(null);
  const [groupsModalOpen, setGroupsModalOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const holder = useRef<HTMLDivElement>(null);
  const paperRef = useRef<dia.Paper | null>(null);
  const graphRef = useRef<dia.Graph | null>(null);
  /** Обработчики полотна вешаются один раз, а данные под ними меняются —
   * поэтому в них смотрит ссылка, которую мы держим свежей. */
  const handlers = useRef<{
    onConnect: (source: dia.Element, target: dia.Element) => void;
    onLinkClick: (linkId: number) => void;
    onDeviceMoved: (deviceId: number, x: number, y: number) => void;
    onGroupMoved: (groupId: number, box: Box) => void;
    onDelete: (selection: Selection) => void;
  }>(null!);
  const selection = useRef<Selection>(null);
  /** Раскладка, сложившаяся в этой сессии: пересчитывать симуляцию на каждое
   * изменение данных значит гонять узлы по экрану под руками у человека. */
  const placed = useRef(new Map<number, { x: number; y: number }>());
  const autoSaved = useRef(new Set<number>());
  const [relayout, setRelayout] = useState(0);
  /** Свежие действия для панелей: обработчики полотна ставятся один раз, а
   * данные под ними меняются. */
  const actionsRef = useRef<JointActions>(null!);

  const filteredDevices = useMemo(
    () => (tagFilter ? devices.filter((d) => d.tags.some((t) => String(t.id) === tagFilter)) : devices),
    [devices, tagFilter],
  );

  function changeLook(next: TopologyAppearance) {
    setLook(next);
    saveAppearance(next);
  }

  // ---------- действия панелей ----------
  const actions: JointActions = useMemo(() => ({
    edit: (deviceId: number) => {
      const device = devices.find((d) => d.id === deviceId);
      if (device) setEditingDevice(device);
    },
    copy: (deviceId: number) => {
      const source = devices.find((d) => d.id === deviceId);
      if (!source) return;
      createDevice.mutate({
        template_id: source.template_id, name: source.name, location: source.location,
        role: source.role, notes: source.notes, topology_group_id: source.topology_group_id,
        tag_ids: source.tags.map((t) => t.id),
        // IP и дата установки у каждой железки свои — копировать их значит
        // получить конфликт адресов.
      }, {
        onSuccess: (created) => {
          notifySuccess(`Создано устройство ${created.code}`);
          const at = placed.current.get(deviceId);
          if (at) updatePosition.mutate({ id: created.id, body: { x: at.x + 60, y: at.y + 90 } });
        },
        onError: notifyError,
      });
    },
    regroup: (deviceId: number) => setRegrouping(deviceId),
    remove: (deviceId: number) => {
      const device = devices.find((d) => d.id === deviceId);
      if (!device) return;
      if (!confirm(`Удалить устройство «${device.code}» вместе с портами и связями?`)) return;
      deleteDevice.mutate(deviceId, { onError: notifyError });
    },
    editGroup: (groupId: number) => {
      const group = groups.find((g) => g.id === groupId);
      if (group) setEditingGroup({ group, parentId: null });
    },
    addSubgroup: (groupId: number) => setEditingGroup({ group: null, parentId: groupId }),
    removeGroup: (groupId: number) => {
      const group = groups.find((g) => g.id === groupId);
      if (!group) return;
      if (!confirm(`Удалить группу «${group.name}»? Устройства останутся, подгруппы поднимутся на уровень выше.`)) return;
      deleteGroup.mutate(groupId, { onSuccess: () => notifySuccess('Группа удалена'), onError: notifyError });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [devices, groups]);

  actionsRef.current = actions;

  const saveGroupBox = useCallback((groupId: number, box: Box) => {
    setGroupBox.mutate({ id: groupId, body: box }, { onError: notifyError });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  handlers.current = {
    onConnect: (source, target) => {
      const sourceKind = source.get('kind');
      const targetKind = target.get('kind');
      if (sourceKind === 'stub' || targetKind === 'stub') {
        const stub = sourceKind === 'stub' ? source : target;
        const device = sourceKind === 'stub' ? target : source;
        if (device.get('kind') !== 'device') return;
        setAttaching({ linkId: stub.get('linkId'), deviceId: device.get('deviceId') });
        return;
      }
      if (sourceKind !== 'device' || targetKind !== 'device') return;
      const sourceId = source.get('deviceId');
      const targetId = target.get('deviceId');
      if (sourceId === targetId) return;
      setConnecting({ sourceId, targetId });
    },
    onLinkClick: (linkId) => {
      const link = links.find((l) => l.id === linkId);
      if (link) setEditingLink(link);
    },
    onDeviceMoved: (deviceId, x, y) => {
      placed.current.set(deviceId, { x, y });
      updatePosition.mutate({ id: deviceId, body: { x, y } });
    },
    onGroupMoved: (groupId, box) => saveGroupBox(groupId, box),
    onDelete: (target) => {
      if (!target) return;
      if (target.kind === 'device') actions.remove(target.id);
      else actions.removeGroup(target.id);
    },
  };

  // ---------- полотно ----------
  useEffect(() => {
    const element = holder.current;
    if (!element) return;

    const graph = new dia.Graph({}, { cellNamespace: shapes });
    // Своего контейнера полотну не отдаём: `paper.remove()` уносит именно тот
    // элемент, который ему передали, и после повторного монтирования рисовать
    // было бы уже некуда. Размер — числами: на контейнере нулевого размера
    // JointJS падает с невырожденной матрицей.
    const paper = new dia.Paper({
      model: graph,
      cellViewNamespace: shapes,
      width: Math.max(element.clientWidth, 320),
      height: Math.max(element.clientHeight, 320),
      gridSize: 10,
      // Кабель тянут от кнопки на панели узла, поэтому «висящих» концов у
      // временной линии быть не должно: отпустил мимо — линия исчезла.
      linkPinning: false,
      defaultLink: () => new shapes.standard.Link({
        attrs: {
          line: {
            stroke: '#1971c2', strokeWidth: 2, strokeDasharray: '6 4',
            targetMarker: { type: 'path', d: 'M 8 -4 0 0 8 4 z', fill: '#1971c2' },
          },
        },
      }),
      validateConnection: (sourceView, _sm, targetView, _tm) => {
        const source = sourceView?.model as dia.Element | undefined;
        const target = targetView?.model as dia.Element | undefined;
        if (!source || !target || source === target) return false;
        const kinds = [source.get('kind'), target.get('kind')];
        // Кабель соединяет два устройства либо повисший конец с устройством.
        if (kinds.includes('group')) return false;
        return kinds.filter((k) => k === 'device').length >= 1;
      },
      // Узел не выходит за рамку своей группы — то же правило, что и на
      // основной схеме: состав группы меняется только явно, а не перетаскиванием.
      restrictTranslate: (elementView) => {
        const parent = elementView.model.getParentCell() as dia.Element | null;
        // `false` — «двигай куда хочешь»: у узла без группы ограничений нет.
        // Именно false, а не true: возвращённое из функции значение JointJS
        // берёт как готовую рамку и на `true` считает координаты из
        // несуществующих полей — узел уезжал в NaN, а сервер отбивал
        // сохранение позиции.
        return parent ? parent.getBBox().toJSON() : false;
      },
      // Линия начинается на границе узла, а не в его середине. Иначе путь
      // кабеля уходит внутрь карточки, и подписи портов, отмеряемые от его
      // начала, оказываются под ней.
      defaultConnectionPoint: { name: 'boundary', args: { offset: 2 } },
      interactive: (cellView) => {
        if (!canEdit) return false;
        // Заглушку свободного конца не двигают: за неё тянут кабель, и жест
        // не должен быть двусмысленным.
        if (cellView.model.get('kind') === 'stub') return { elementMove: false };
        return { linkMove: false, labelMove: false };
      },
    });
    element.appendChild(paper.el);
    paper.unfreeze();

    const observer = new ResizeObserver(() => {
      paper.setDimensions(Math.max(element.clientWidth, 320), Math.max(element.clientHeight, 320));
    });
    observer.observe(element);

    // Панорама тягой за пустое место, масштаб колесом.
    let panning: { x: number; y: number } | null = null;
    paper.on('blank:pointerdown', (event: dia.Event) => {
      panning = { x: event.clientX ?? 0, y: event.clientY ?? 0 };
    });
    paper.on('blank:pointermove cell:pointermove', (event: dia.Event) => {
      if (!panning) return;
      const t = paper.translate();
      paper.translate(t.tx + ((event.clientX ?? 0) - panning.x), t.ty + ((event.clientY ?? 0) - panning.y));
      panning = { x: event.clientX ?? 0, y: event.clientY ?? 0 };
    });
    paper.on('blank:pointerup cell:pointerup', () => { panning = null; });
    paper.on('blank:mousewheel cell:mousewheel', (...args: unknown[]) => {
      const delta = args[args.length - 1] as number;
      paper.scale(Math.min(2.5, Math.max(0.2, paper.scale().sx * (delta > 0 ? 1.1 : 0.9))));
    });

    // Выделение: панель действий появляется по клику, как и на основной схеме.
    paper.on('element:pointerclick', (view: dia.ElementView) => {
      const model = view.model;
      const kind = model.get('kind');
      paper.removeTools();
      highlighters.stroke.removeAll(paper);
      if (kind === 'device') {
        selection.current = { kind: 'device', id: model.get('deviceId') };
        highlighters.stroke.add(view, 'body', 'selected', {
          padding: 3, rx: 12, ry: 12, attrs: { stroke: '#1971c2', 'stroke-width': 2 },
        });
        if (canEdit) view.addTools(deviceTools(model.get('deviceId'), actionsProxy()));
      } else if (kind === 'group') {
        selection.current = { kind: 'group', id: model.get('groupId') };
        if (canEdit) view.addTools(groupTools(model.get('groupId'), actionsProxy(), model.get('accent') ?? '#4dabf7'));
      } else {
        selection.current = null;
      }
    });
    paper.on('blank:pointerclick', () => {
      selection.current = null;
      paper.removeTools();
      highlighters.stroke.removeAll(paper);
    });
    paper.on('link:pointerclick', (view: dia.LinkView) => {
      const linkId = view.model.get('linkId');
      if (linkId) handlers.current.onLinkClick(linkId);
    });

    // Перетащили — сохраняем: устройство своей позицией, рамку — своей.
    paper.on('element:pointerup', (view: dia.ElementView) => {
      if (!canEdit) return;
      const model = view.model;
      if (model.get('kind') === 'device') {
        const center = model.getBBox().center();
        handlers.current.onDeviceMoved(model.get('deviceId'), center.x, center.y);
      } else if (model.get('kind') === 'group') {
        const box = model.getBBox();
        handlers.current.onGroupMoved(model.get('groupId'), {
          x: box.x, y: box.y, width: box.width, height: box.height,
        });
        // Содержимое уехало вместе с рамкой — его новые координаты тоже нужно
        // записать: в базе они абсолютные.
        for (const child of model.getEmbeddedCells({ deep: true })) {
          if (child.get('kind') !== 'device') continue;
          const at = (child as dia.Element).getBBox().center();
          handlers.current.onDeviceMoved(child.get('deviceId'), at.x, at.y);
        }
      }
    });

    // Растянули рамку за угол. Размер меняется на каждое движение мыши, а
    // записывать его на каждый пиксель — сотня запросов на одно движение;
    // поэтому сохраняем, когда рука остановилась.
    let resizeTimer: number | undefined;
    graph.on('change:size', (cell: dia.Cell) => {
      if (!canEdit || cell.get('kind') !== 'group') return;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const box = (cell as dia.Element).getBBox();
        handlers.current.onGroupMoved(cell.get('groupId'), {
          x: box.x, y: box.y, width: box.width, height: box.height,
        });
      }, 350);
    });

    // Протянули кабель: временная линия не остаётся на схеме — вместо неё
    // открывается окно выбора портов, а связь создаёт сервер.
    paper.on('link:connect', (linkView: dia.LinkView) => {
      const source = linkView.model.getSourceCell() as dia.Element | null;
      const target = linkView.model.getTargetCell() as dia.Element | null;
      linkView.model.remove();
      if (source && target) handlers.current.onConnect(source, target);
    });

    paperRef.current = paper;
    graphRef.current = graph;
    return () => {
      window.clearTimeout(resizeTimer);
      observer.disconnect();
      paper.remove();
      paperRef.current = null;
      graphRef.current = null;
    };

    /** Панели действий берут обработчики в момент клика — так в них не
     * застывает состояние того рендера, на котором рисовали узел. */
    function actionsProxy() {
      return {
        edit: (id: number) => actionsRef.current.edit(id),
        copy: (id: number) => actionsRef.current.copy(id),
        regroup: (id: number) => actionsRef.current.regroup(id),
        remove: (id: number) => actionsRef.current.remove(id),
        editGroup: (id: number) => actionsRef.current.editGroup(id),
        addSubgroup: (id: number) => actionsRef.current.addSubgroup(id),
        removeGroup: (id: number) => actionsRef.current.removeGroup(id),
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);

  // Delete удаляет выделенное — как и на основной схеме.
  useEffect(() => {
    if (!canEdit) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const active = document.activeElement;
      if (active && ['INPUT', 'TEXTAREA'].includes(active.tagName)) return;
      handlers.current.onDelete(selection.current);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit]);

  // ---------- наполнение ----------
  useEffect(() => {
    const graph = graphRef.current;
    const paper = paperRef.current;
    if (!graph || !paper) return;

    paper.removeTools();
    highlighters.stroke.removeAll(paper);
    graph.clear();
    if (filteredDevices.length === 0) return;

    const positions = computePositions(filteredDevices, links, placed, relayout);
    const boxes = computeBoxes(groups, filteredDevices, positions);

    // Рамки — раньше устройств: JointJS кладёт ячейки в порядке добавления,
    // и рамка, добавленная позже, перекрыла бы узлы.
    const groupCells = new Map<number, dia.Element>();
    const byDepth = [...groups].sort((a, b) => groupDepth(groups, a.id) - groupDepth(groups, b.id));
    for (const group of byDepth) {
      const box = boxes.get(group.id);
      if (!box) continue;
      const accent = group.color ?? '#4dabf7';
      const fade = [1, 0.6, 0.4][Math.min(groupDepth(groups, group.id), 2)];
      const inside = filteredDevices.filter((d) => d.topology_group_id === group.id).length;
      const title = look.groupCount ? `${group.name} · ${inside}` : group.name;
      const cell = new GroupShape({
        position: { x: box.x, y: box.y },
        size: { width: box.width, height: box.height },
        kind: 'group',
        groupId: group.id,
        accent,
        z: 1,
        attrs: {
          body: {
            stroke: look.groupBorder === 'none' ? 'transparent' : tint(accent, 100 * fade),
            strokeWidth: look.groupBorderWidth,
            strokeDasharray: look.groupBorder === 'dashed' ? '7 5' : look.groupBorder === 'dotted' ? '2 4' : undefined,
            rx: look.groupRadius, ry: look.groupRadius,
            fill: look.groupFill > 0 ? tint(accent, look.groupFill * fade) : 'transparent',
          },
          label: { text: look.groupTitle === 'hidden' ? '' : title, fill: accent },
          labelBack: {
            width: look.groupTitle === 'hidden' ? 0 : title.length * 7 + 14,
            fill: look.groupTitle === 'onFrame' ? '#ffffff' : 'transparent',
            y: look.groupTitle === 'onFrame' ? -9 : 2,
          },
        },
      });
      graph.addCell(cell);
      groupCells.set(group.id, cell);

      const parentCell = group.parent_id != null ? groupCells.get(group.parent_id) : undefined;
      if (parentCell) parentCell.embed(cell);
    }

    const deviceCells = new Map<number, dia.Element>();
    for (const device of filteredDevices) {
      const template = templates.find((t) => t.id === device.template_id);
      const accent = template?.color ?? NEUTRAL;
      const raw = positions.get(device.id)!;
      const connected = device.interfaces.filter((i) => i.link_id).length;
      const typeName = template ? types.find((t) => t.id === template.device_type_id)?.name ?? '' : '';
      const groupCell = device.topology_group_id != null ? groupCells.get(device.topology_group_id) : undefined;
      const frame = device.topology_group_id != null ? boxes.get(device.topology_group_id) : undefined;
      // Узел не должен торчать из своей рамки. Перетаскивание за неё не
      // выпускает само полотно, но координаты, пришедшие из базы, оно не
      // подрезает: рамку могли сузить, а устройство — перенести в группу
      // из другого угла схемы.
      const at = clampToFrame({ x: raw.x - NODE.width / 2, y: raw.y - NODE.height / 2 }, frame);

      const cell = new DeviceShape({
        position: at,
        kind: 'device',
        deviceId: device.id,
        z: 10,
        attrs: {
          // Рамка-градиент по цвету модели — как на основной схеме.
          border: {
            fill: {
              type: 'linearGradient',
              stops: [{ offset: '0%', color: accent }, { offset: '100%', color: withAlpha(accent, 0.25) }],
              attrs: { x1: 0, y1: 0, x2: 1, y2: 1 },
            },
            filter: look.deviceGlow
              ? { name: 'dropShadow', args: { dx: 0, dy: 1, blur: 5, color: withAlpha(accent, 0.35) } }
              : null,
          },
          dot: { fill: accent },
          code: { text: device.code },
          ports: {
            text: look.devicePorts ? `${connected}/${device.interfaces.length}` : '',
            fill: connected > 0 ? '#0ca678' : '#868e96',
          },
          name: { text: look.deviceSubtitle ? cut(device.name || template?.name || typeName || '—', 26) : '' },
        },
      });
      graph.addCell(cell);
      deviceCells.set(device.id, cell);

      if (groupCell) groupCell.embed(cell);
    }

    const deviceOfInterface = new Map<number, number>();
    const portOfInterface = new Map<number, { number: number; label: string }>();
    for (const device of filteredDevices) {
      for (const iface of device.interfaces) {
        deviceOfInterface.set(iface.id, device.id);
        portOfInterface.set(iface.id, { number: iface.port_number, label: iface.label });
      }
    }

    // Кабели, приходящие в одно устройство, должны входить в него в разных
    // точках, иначе при ортогональной разводке они ложатся друг на друга и
    // видно одну линию вместо пяти. Считаем каждому концу его номер у своей
    // железки и разносим точки входа по высоте узла.
    const endsOfDevice = new Map<number, number[]>();
    for (const link of links) {
      for (const ifaceId of [link.interface_a_id, link.interface_b_id]) {
        const deviceId = ifaceId != null ? deviceOfInterface.get(ifaceId) : undefined;
        if (deviceId == null) continue;
        if (!endsOfDevice.has(deviceId)) endsOfDevice.set(deviceId, []);
        endsOfDevice.get(deviceId)!.push(link.id);
      }
    }
    const anchorFor = (deviceId: number, linkId: number) => {
      const ends = endsOfDevice.get(deviceId) ?? [];
      const index = ends.indexOf(linkId);
      const spread = Math.min(ends.length, 5);
      const dy = spread <= 1 ? 0 : ((index % spread) - (spread - 1) / 2) * 18;
      return { name: 'center', args: { dy } };
    };
    // Коридоры разводки тоже разные: одинаковый отступ сводит соседние
    // кабели в одну линию ровно так же, как одинаковая точка входа. Шаг
    // подобран так, чтобы соседние коридоры было видно как отдельные, а не
    // как утолщённую линию.
    const linkOrder = new Map(links.map((l, index) => [l.id, index]));
    const routerFor = (linkId: number) => (router === 'orthogonal'
      ? { name: 'manhattan', args: { step: 16, padding: 22 + ((linkOrder.get(linkId) ?? 0) % 4) * 18 } }
      : undefined);
    // Пересечения показываем «мостиком»: без него две пересекающиеся линии
    // читаются как одна с ответвлением.
    const connectorFor = () => (router === 'orthogonal'
      ? { name: 'jumpover', args: { size: 5, jump: 'arc' } }
      : { name: 'rounded', args: { radius: 8 } });
    // При ортогональной разводке линия обходит узлы стороной, поэтому её
    // можно класть поверх карточек — иначе подписи портов у самого узла
    // прячутся под ним. Прямая линия узлы пересекает, и там она остаётся
    // под ними.
    const linkZ = router === 'orthogonal' ? 20 : 5;

    for (const link of links) {
      const aDevice = link.interface_a_id != null ? deviceOfInterface.get(link.interface_a_id) : undefined;
      const bDevice = link.interface_b_id != null ? deviceOfInterface.get(link.interface_b_id) : undefined;
      const template = link.template_id ? linkTemplates.find((t) => t.id === link.template_id) : null;

      // Оба конца на месте — обычный кабель.
      if (aDevice != null && bDevice != null) {
        const source = deviceCells.get(aDevice);
        const target = deviceCells.get(bDevice);
        if (!source || !target) continue;
        graph.addCell(new shapes.standard.Link({
          source: { id: source.id, anchor: anchorFor(aDevice, link.id) },
          target: { id: target.id, anchor: anchorFor(bDevice, link.id) },
          linkId: link.id,
          router: routerFor(link.id),
          connector: connectorFor(),
          z: linkZ,
          attrs: {
            line: {
              stroke: template?.color ?? '#9aa1ab',
              strokeWidth: look.edgeWidth,
              strokeDasharray: template?.line_style === 'dashed' ? '7 5'
                : template?.line_style === 'dotted' ? '2 4' : undefined,
              opacity: link.confirmed ? 0.9 : 0.45,
              targetMarker: null,
            },
          },
          labels: look.edgeLabels ? [
            portLabelCell(portText(portOfInterface.get(link.interface_a_id!), look), 46,
                          labelShift(endsOfDevice.get(aDevice), link.id)),
            portLabelCell(portText(portOfInterface.get(link.interface_b_id!), look), -46,
                          labelShift(endsOfDevice.get(bDevice), link.id)),
          ] : [],
        }));
        continue;
      }

      // Один конец повис: рисуем заглушку под живым устройством — кабель
      // никуда не делся, его просто некуда воткнуть.
      const liveInterface = link.interface_a_id ?? link.interface_b_id;
      const liveDevice = liveInterface != null ? deviceOfInterface.get(liveInterface) : undefined;
      const deviceCell = liveDevice != null ? deviceCells.get(liveDevice) : undefined;
      if (!deviceCell || liveInterface == null) continue;

      const anchor = deviceCell.getBBox();
      const stub = new StubShape({
        position: { x: anchor.x + NODE.width / 2 - STUB_SIZE / 2, y: anchor.y + NODE.height + 42 },
        kind: 'stub',
        linkId: link.id,
        z: 10,
      });
      graph.addCell(stub);
      graph.addCell(new shapes.standard.Link({
        source: { id: deviceCell.id }, target: { id: stub.id },
        linkId: link.id,
        z: linkZ,
        attrs: {
          line: {
            stroke: '#f76707', strokeWidth: look.edgeWidth, strokeDasharray: '4 4',
            opacity: 0.9, targetMarker: null,
          },
        },
        labels: look.edgeLabels ? [
          portLabelCell(portText(portOfInterface.get(liveInterface), look), 34),
        ] : [],
      }));
    }

    // Заведённые до появления ручной правки группы получают посчитанную
    // рамку один раз — дальше она живёт своей жизнью.
    for (const group of groups) {
      const box = boxes.get(group.id);
      if (!box || storedBox(group) || autoSaved.current.has(group.id) || !canEdit) continue;
      autoSaved.current.add(group.id);
      setGroupBox.mutate({
        id: group.id,
        body: { x: box.x, y: box.y, width: box.width + GROUP_SLACK, height: box.height + GROUP_SLACK },
      });
    }

    if (graph.getCells().length > 0) {
      paper.transformToFitContent({ padding: 60, maxScale: 1.1, useModelGeometry: true });
    }

    // Пришли по ссылке с карточки устройства — показываем именно его.
    const focusId = searchParams.get('device');
    if (focusId) {
      const cell = deviceCells.get(parseInt(focusId, 10));
      if (cell) {
        paper.transformToFitContent({
          contentArea: cell.getBBox().inflate(320), maxScale: 1.4, useModelGeometry: true,
        });
        highlighters.stroke.add(cell.findView(paper) as dia.ElementView, 'body', 'focused', {
          padding: 3, rx: 12, ry: 12, attrs: { stroke: '#1971c2', 'stroke-width': 2 },
        });
      }
      const rest = new URLSearchParams(searchParams);
      rest.delete('device');
      setSearchParams(rest, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredDevices, links, templates, types, linkTemplates, groups, look, router, relayout, canEdit]);

  /** Новое устройство появляется в середине видимой области. */
  function placeNewDevice(deviceId: number) {
    const paper = paperRef.current;
    if (!paper) return;
    const area = paper.getArea();
    updatePosition.mutate({ id: deviceId, body: { x: area.x + area.width / 2, y: area.y + area.height / 2 } });
  }

  return (
    <Stack h="100%" gap="sm">
      <Group justify="space-between">
        <Title order={2}>Схема связей (JointJS)</Title>
        <Group>
          <Select
            placeholder="Все теги" clearable w={180}
            data={flattenTagsOrdered(tags).map(({ tag, depth }) => ({
              value: String(tag.id), label: `${'—'.repeat(depth)} ${tag.name}`,
            }))}
            value={tagFilter} onChange={setTagFilter}
          />
          <SegmentedControl
            size="xs" value={router}
            onChange={(value) => setRouter(value as 'orthogonal' | 'straight')}
            data={[{ value: 'orthogonal', label: 'Ортогонально' }, { value: 'straight', label: 'Прямыми' }]}
          />
          {canEdit && (
            <Button variant="light" leftSection={<IconUsersGroup size={16} />} onClick={() => setGroupsModalOpen(true)}>
              Группы
            </Button>
          )}
          <AppearanceMenu value={look} onChange={changeLook} />
          <Button
            variant="default" leftSection={<IconFocusCentered size={16} />}
            onClick={() => {
              setRelayout((n) => n + 1);
              paperRef.current?.transformToFitContent({ padding: 60, maxScale: 1.1, useModelGeometry: true });
            }}
          >
            Вписать
          </Button>
          {canEdit && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setAddingDevice(true)}>
              Устройство
            </Button>
          )}
        </Group>
      </Group>

      <Paper withBorder style={{ height: 640, overflow: 'hidden' }}>
        <div ref={holder} style={{ width: '100%', height: '100%' }} />
      </Paper>

      <Text c="dimmed" size="sm">
        Клик по узлу открывает панель: править, копировать, в группу, удалить и «протянуть кабель» — за последнюю
        кнопку тянут до другого устройства, а порты выбираются в окне. Клик по рамке группы — своя панель: правка,
        подгруппа, удаление; рамку двигают мышью и растягивают за угол. Оранжевый кружок с «?» — свободный конец
        кабеля: его тянут на устройство, чтобы воткнуть в порт. Клик по линии открывает правку связи, Delete удаляет
        выделенное. Узел за рамку своей группы не выходит, а состав группы меняется только явно.
      </Text>

      {groupsModalOpen && <TopologyGroupsModal onClose={() => setGroupsModalOpen(false)} />}
      {addingDevice && (
        <DeviceFormModal device={null} onCreated={placeNewDevice} onClose={() => setAddingDevice(false)} />
      )}
      {editingDevice && <DeviceFormModal device={editingDevice} onClose={() => setEditingDevice(null)} />}
      {editingLink && (
        <LinkFormModal link={editingLink} templates={linkTemplates} onClose={() => setEditingLink(null)} />
      )}
      {connecting && (
        <ConnectPortsModal
          sourceId={connecting.sourceId} targetId={connecting.targetId}
          onClose={() => setConnecting(null)}
        />
      )}
      {attaching && (
        <AttachEndModal
          linkId={attaching.linkId} deviceId={attaching.deviceId}
          onClose={() => setAttaching(null)}
        />
      )}
      {editingGroup && (
        <GroupEditModal
          group={editingGroup.group} parentId={editingGroup.parentId}
          onClose={() => setEditingGroup(null)}
        />
      )}
      {regrouping != null && (
        <DeviceGroupModal deviceId={regrouping} onClose={() => setRegrouping(null)} />
      )}
    </Stack>
  );
}

/** Сдвиг подписи поперёк линии: у устройства с несколькими кабелями подписи
 * сходятся в одну точку и наезжают друг на друга. */
function labelShift(ends: number[] | undefined, linkId: number): number {
  if (!ends || ends.length <= 1) return 0;
  const index = ends.indexOf(linkId);
  return (index % 2 === 0 ? -1 : 1) * (10 + Math.floor(index / 2) * 4);
}

/** Загнать узел внутрь рамки: рамка — это область, за которую он не выходит. */
function clampToFrame(at: { x: number; y: number }, frame: Box | undefined) {
  if (!frame) return at;
  const pad = 8;
  return {
    x: Math.min(Math.max(at.x, frame.x + pad), Math.max(frame.x + pad, frame.x + frame.width - NODE.width - pad)),
    y: Math.min(Math.max(at.y, frame.y + 24), Math.max(frame.y + 24, frame.y + frame.height - NODE.height - pad)),
  };
}

function cut(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function portText(port: { number: number; label: string } | undefined, look: TopologyAppearance): string {
  if (!port) return '';
  return look.edgeLabelName && port.label ? `№${port.number} · ${port.label}` : `№${port.number}`;
}

/** Подпись конца кабеля: в нескольких десятках точек от своего конца линии.
 * Целые числа JointJS понимает как расстояние в точках от начала, а
 * отрицательные — от конца; доли прижимали бы подпись вплотную к узлу. */
function portLabelCell(text: string, distance: number, offset = 0) {
  return {
    position: { distance, offset },
    attrs: {
      labelBody: { fill: '#ffffff', stroke: '#dee2e6', strokeWidth: 1, rx: 4, ry: 4 },
      labelText: { text, fontSize: 10, fill: '#495057', fontFamily: 'inherit' },
    },
    markup: [
      { tagName: 'rect', selector: 'labelBody' },
      { tagName: 'text', selector: 'labelText' },
    ],
  };
}

/** Положение узлов: сохранённое в базе, затем сложившееся в этой сессии, и
 * только новым устройствам считается пружинная раскладка. */
function computePositions(
  devices: DeviceOut[],
  links: LinkOut[],
  placed: React.RefObject<Map<number, { x: number; y: number }>>,
  relayout: number,
) {
  const nodes: LayoutNode[] = devices.map((d) => {
    const saved = relayout > 0 ? undefined
      : (d.topology_x != null && d.topology_y != null
        ? { x: d.topology_x, y: d.topology_y }
        : placed.current!.get(d.id));
    return {
      id: String(d.id),
      x: saved?.x ?? Math.random() * 1100,
      y: saved?.y ?? Math.random() * 700,
      vx: 0, vy: 0,
      fixed: saved != null,
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ifaceToDevice = new Map<number, number>();
  for (const d of devices) for (const i of d.interfaces) ifaceToDevice.set(i.id, d.id);

  const springs: Spring[] = [];
  for (const link of links) {
    if (link.interface_a_id == null || link.interface_b_id == null) continue;
    const a = byId.get(String(ifaceToDevice.get(link.interface_a_id)));
    const b = byId.get(String(ifaceToDevice.get(link.interface_b_id)));
    if (a && b && a !== b) springs.push({ a, b, idealLen: 240, strength: 0.02 });
  }
  if (nodes.some((n) => !n.fixed)) computeForceLayout(nodes, springs, 1100, 750);

  const result = new Map<number, { x: number; y: number }>();
  for (const node of nodes) {
    const at = { x: node.x, y: node.y };
    result.set(parseInt(node.id, 10), at);
    placed.current!.set(parseInt(node.id, 10), at);
  }
  return result;
}

/** Рамки групп: заданная руками, иначе — по содержимому. */
function computeBoxes(
  groups: TopologyGroupOut[],
  devices: DeviceOut[],
  positions: Map<number, { x: number; y: number }>,
): Map<number, Box> {
  const boxes = new Map<number, Box>();
  const measure = (group: TopologyGroupOut, visited: Set<number>): Box | null => {
    if (visited.has(group.id)) return null;
    visited.add(group.id);

    const stored = storedBox(group);
    if (stored) {
      boxes.set(group.id, stored);
      return stored;
    }

    const parts: Box[] = [];
    for (const device of devices) {
      if (device.topology_group_id !== group.id) continue;
      const at = positions.get(device.id);
      if (!at) continue;
      parts.push({
        x: at.x - NODE.width / 2, y: at.y - NODE.height / 2,
        width: NODE.width, height: NODE.height,
      });
    }
    for (const child of groups.filter((g) => g.parent_id === group.id)) {
      const box = measure(child, visited);
      if (box) parts.push(box);
    }
    // Пустая группа без заданной рамки не рисуется: пустой прямоугольник
    // только мешает, а сама группа никуда не делась.
    if (parts.length === 0) return null;

    const minX = Math.min(...parts.map((p) => p.x)) - GROUP_PADDING;
    const minY = Math.min(...parts.map((p) => p.y)) - GROUP_PADDING;
    const maxX = Math.max(...parts.map((p) => p.x + p.width)) + GROUP_PADDING;
    const maxY = Math.max(...parts.map((p) => p.y + p.height)) + GROUP_PADDING;
    const box = {
      x: minX, y: minY,
      width: Math.max(maxX - minX, GROUP_MIN.width),
      height: Math.max(maxY - minY, GROUP_MIN.height),
    };
    boxes.set(group.id, box);
    return box;
  };

  for (const group of groups.filter((g) => g.parent_id == null)) measure(group, new Set());
  return boxes;
}
