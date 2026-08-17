import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Group, Paper, Popover, SegmentedControl, Select, Stack, Text, Title,
  useComputedColorScheme,
} from '@mantine/core';
import {
  IconArrowBackUp, IconArrowForwardUp, IconFocusCentered, IconHelp,
  IconLayoutDistributeHorizontal, IconPlus, IconUsersGroup,
} from '@tabler/icons-react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { highlighters, type dia } from '@joint/core';
import {
  useDeleteDevice, useDeleteTopologyGroup, useSetTopologyGroupBox, useTags,
  useTopology, useTopologyGroups, useUpdateDevicePosition, useUpdateDevicePositions,
} from '../api/hooks';
import * as apiEndpoints from '../api/endpoints';
import { ConnectPortsModal } from './topology/ConnectPortsModal';
import { AttachEndModal } from './topology/AttachEndModal';
import { GroupEditModal } from './topology/GroupEditModal';
import { DeviceGroupModal } from './topology/DeviceGroupModal';
import { TopologyGroupsModal } from './topology/TopologyGroupsModal';
import { DeviceModalById, LinkModalById } from './topology/OpenById';
import { DeviceFormModal, type DeviceDraft } from './devices/DeviceFormModal';
import { AppearanceMenu } from './topology/AppearanceMenu';
import { loadAppearance, saveAppearance, type TopologyAppearance } from './topology/appearance';
import {
  buildGraph, cardText, computePositions, storedBox, type Box, type Point,
} from './topology/joint/buildGraph';
import { GROUP_MIN, nodeMetrics, nodeSizes } from './topology/joint/shapes';
import { computeAutoLayout, type AutoCard } from './topology/layout';
import { useLayoutHistory, type LayoutStep } from './topology/joint/useLayoutHistory';
import {
  useJointPaper, type JointActions, type PaperHandlers,
} from './topology/joint/useJointPaper';
import { flattenTagsOrdered } from '../lib/utils';
import { notifyError, notifySuccess } from '../lib/notify';
import { useCan } from '../auth/permissions';
import type { TopologyGroupOut } from '../api/types';

/** Схема связей.
 *
 * Умеет всё, ради чего на неё приходят: завести и править устройство,
 * протянуть кабель, подключить повисший конец, разложить по группам,
 * подвинуть и растянуть рамку, удалить.
 *
 * Сделана на JointJS. Был и второй вариант, на React Flow, — они какое-то
 * время жили рядом, чтобы выбрать; выбор сделан в пользу JointJS ради
 * ортогональной разводки: он сам обводит кабели вокруг узлов, а не рисует
 * их напрямик через чужие карточки. Второй вариант удалён, чтобы схему не
 * приходилось чинить дважды.
 *
 * Саму схему собирает сервер: `GET /topology` отдаёт узлы и линии в том
 * виде, в каком они рисуются. Раньше браузер получал всю площадку со всеми
 * портами и сшивал картинку сам — двадцать четыре тысячи вложенных объектов
 * на тысячу устройств ради дроби «1/4» на карточке и номера порта у конца
 * кабеля.
 *
 * Здесь остались только три вещи: что показывать, что делают кнопки и какие
 * окна открыты. Полотно с его событиями живёт в `joint/useJointPaper`, а
 * превращение присланной схемы в ячейки — в `joint/buildGraph`.
 */

const EMPTY: never[] = [];
/** Запас у рамки, посчитанной по содержимому: внутри должно остаться место,
 * чтобы узлы можно было двигать. */
const GROUP_SLACK = 90;

/** Заведение устройства с полотна: пустой запрос — обычная кнопка «плюс»,
 * заполненный черновик — копия или «устройство в эту группу». */
interface AddDeviceRequest {
  draft?: DeviceDraft;
  /** Устройство рядом с которым поставить новое — копия встаёт рядом с
   * оригиналом, а не в центре экрана, как обычное новое устройство. */
  placeNear?: number;
}

export function TopologyPage() {
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  // Отбор по тегу делает сервер: спрятать устройство значит спрятать и его
  // кабели, а решать это по половине данных нельзя.
  const { data: topology } = useTopology(tagFilter ? parseInt(tagFilter, 10) : null);
  const { data: tags = EMPTY } = useTags();
  const { data: groups = EMPTY } = useTopologyGroups();
  const nodes = topology?.nodes ?? EMPTY;
  const edges = topology?.edges ?? EMPTY;

  const canEdit = useCan('edit');
  const queryClient = useQueryClient();
  const updatePosition = useUpdateDevicePosition();
  const updatePositions = useUpdateDevicePositions();
  const deleteDevice = useDeleteDevice();
  const deleteGroup = useDeleteTopologyGroup();
  const setGroupBox = useSetTopologyGroupBox();

  // Полотно схемы — это фон страницы, поэтому подписи, врезки и кнопки
  // красятся от темы интерфейса, а не наугад.
  const scheme = useComputedColorScheme('light');
  const [look, setLook] = useState<TopologyAppearance>(loadAppearance);
  const [addingDevice, setAddingDevice] = useState<AddDeviceRequest | null>(null);
  const [editingDeviceId, setEditingDeviceId] = useState<number | null>(null);
  const [editingLinkId, setEditingLinkId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState<{ sourceId: number; targetId: number } | null>(null);
  const [attaching, setAttaching] = useState<{ linkId: number; deviceId: number } | null>(null);
  const [editingGroup, setEditingGroup] = useState<{ group: TopologyGroupOut | null; parentId: number | null } | null>(null);
  const [regrouping, setRegrouping] = useState<number | null>(null);
  const [groupsModalOpen, setGroupsModalOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  /** Раскладка, сложившаяся в этой сессии: пересчитывать симуляцию на каждое
   * изменение данных значит гонять узлы по экрану под руками у человека. */
  const placed = useRef(new Map<number, Point>());
  const autoSaved = useRef(new Set<number>());
  /** Для какой по счёту раскладки уже подгоняли масштаб. −1 — ещё ни разу,
   * то есть первое наполнение схемы. */
  const fitted = useRef(-1);
  /** Сколько раз схему разложили заново: сама раскладка живёт в `placed`, а
   * этот счётчик просит перерисовку и подгонку масштаба под новое. */
  const [relayout, setRelayout] = useState(0);
  /** Перерисовать схему, не пересчитывая раскладку заново: положение узлов
   * живёт в `placed`, а он не состояние и сам перерисовку не вызывает. */
  const [redraw, setRedraw] = useState(0);
  /** Рамки групп с прошлой отрисовки — нужны, чтобы знать, откуда рамка
   * уехала, и чтобы разложить содержимое внутри неё. */
  const boxesRef = useRef(new Map<number, Box>());
  /** Группы, для которых сейчас считается раскладка: ELK — асинхронный
   * вызов, и второй клик по той же панели до ответа первого не должен
   * запускать вторую раскладку поверх первой. */
  const layingGroups = useRef(new Set<number>());
  /** Свежие действия и обработчики для полотна: оно ставит их один раз, а
   * данные под ними меняются. */
  const actionsRef = useRef<JointActions>(null!);
  const handlers = useRef<PaperHandlers>(null!);

  function changeLook(next: TopologyAppearance) {
    setLook(next);
    saveAppearance(next);
  }

  // ---------- действия панелей ----------
  const actions: JointActions = useMemo(() => ({
    edit: (deviceId: number) => setEditingDeviceId(deviceId),
    copy: async (deviceId: number) => {
      // Схема знает про узел только то, что на нём нарисовано, а копировать
      // надо всю железку — с расположением, ролью и заметками. Поэтому
      // сначала она приезжает целиком, тем же запросом, что и для окна
      // правки: второй раз он уже возьмётся из кэша.
      //
      // Дальше — не немедленное создание, а обычное окно заведения с уже
      // заполненными полями: почти всегда после копии нужно поправить хотя
      // бы название, а молча заведённую копию для этого приходилось
      // открывать снова, уже как правку.
      try {
        const source = await queryClient.fetchQuery({
          queryKey: ['device', deviceId],
          queryFn: () => apiEndpoints.getDevice(deviceId),
        });
        setAddingDevice({
          draft: {
            template_id: source.template_id, name: source.name,
            role: source.role, notes: source.notes, topology_group_id: source.topology_group_id,
            tag_ids: source.tags.map((t) => t.id),
            // IP, MAC и дата установки у каждой железки свои — копировать их
            // значит получить два устройства с одним адресом. MAC к тому же
            // уникален физически: одинаковый у двух железок — это не
            // документация, а ошибка в ней.
          },
          placeNear: deviceId,
        });
      } catch (error) {
        notifyError(error);
      }
    },
    regroup: (deviceId: number) => setRegrouping(deviceId),
    remove: (deviceId: number) => {
      const node = nodes.find((n) => n.id === deviceId);
      if (!node) return;
      if (!confirm(`Удалить устройство «${node.code}» вместе с портами и связями?`)) return;
      deleteDevice.mutate(deviceId, { onError: notifyError });
    },
    editGroup: (groupId: number) => {
      const group = groups.find((g) => g.id === groupId);
      if (group) setEditingGroup({ group, parentId: null });
    },
    addSubgroup: (groupId: number) => setEditingGroup({ group: null, parentId: groupId }),
    addDeviceToGroup: (groupId: number) => setAddingDevice({ draft: { topology_group_id: groupId } }),
    layoutGroup: async (groupId: number) => {
      const box = boxesRef.current.get(groupId);
      if (!box || layingGroups.current.has(groupId)) return;

      // Все группы в поддереве данной группы (включая её саму): ELK увидит
      // полную иерархию и сможет расставить узлы, учитывая кабели через
      // границы подгрупп — без этого пересечения неизбежны.
      const subtreeGroupIds = new Set<number>();
      const collectSubtree = (id: number) => {
        subtreeGroupIds.add(id);
        for (const g of groups) if (g.parent_id === id) collectSubtree(g.id);
      };
      collectSubtree(groupId);

      // Устройства поддерева
      const subtreeNodes = nodes.filter(
        (n) => n.topology_group_id != null && subtreeGroupIds.has(n.topology_group_id),
      );
      if (subtreeNodes.length === 0) return;

      // Подгруппы для ELK: groupId становится корнем раскладки (не рамкой),
      // его прямые дочерние группы получают parent_id: null.
      const subGroupsForElk = groups
        .filter((g) => subtreeGroupIds.has(g.id) && g.id !== groupId)
        .map((g) => ({ id: g.id, parent_id: g.parent_id === groupId ? null : g.parent_id }));

      // Только внутренние кабели (оба конца — внутри поддерева)
      const subtreeNodeIdSet = new Set(subtreeNodes.map((n) => n.id));
      const seenLinks = new Set<string>();
      const internalLinks = edges
        .filter(
          (e) =>
            e.device_a_id != null &&
            e.device_b_id != null &&
            subtreeNodeIdSet.has(e.device_a_id!) &&
            subtreeNodeIdSet.has(e.device_b_id!),
        )
        .map((e) => ({ a: e.device_a_id!, b: e.device_b_id! }))
        .filter((l) => {
          const key = [l.a, l.b].sort().join('~');
          if (seenLinks.has(key)) return false;
          seenLinks.add(key);
          return true;
        });

      layingGroups.current.add(groupId);
      try {
        const sizes = nodeSizes(nodes.map((n) => cardText(n, look)), look);
        const card = nodeMetrics(look);
        // Устройства прямо в данной группе — без родителя в этой раскладке
        // (groupId не участвует рамкой, он задаёт только размер результата).
        const subtreeCards: AutoCard[] = subtreeNodes.map((n) => ({
          id: n.id,
          width: sizes.get(n.id)?.width ?? card.width,
          height: sizes.get(n.id)?.height ?? card.height,
          group: n.topology_group_id === groupId ? null : n.topology_group_id ?? null,
        }));

        const laid = await computeAutoLayout(
          subtreeCards,
          subGroupsForElk,
          internalLinks,
          { row: look.layoutRowGap, node: look.layoutNodeGap },
          look.layoutAlgorithm,
        );

        // Находим размах результата в координатах ELK, чтобы сдвинуть
        // содержимое в координаты рамки groupId.
        const SIDE = 26, TOP = 46; // совпадают с FRAME_PADDING из layout.ts
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const c of subtreeCards) {
          const pos = laid.positions.get(c.id);
          if (!pos) continue;
          minX = Math.min(minX, pos.x - c.width / 2);
          minY = Math.min(minY, pos.y - c.height / 2);
          maxX = Math.max(maxX, pos.x + c.width / 2);
          maxY = Math.max(maxY, pos.y + c.height / 2);
        }
        for (const [, subBox] of laid.boxes) {
          minX = Math.min(minX, subBox.x);
          minY = Math.min(minY, subBox.y);
          maxX = Math.max(maxX, subBox.x + subBox.width);
          maxY = Math.max(maxY, subBox.y + subBox.height);
        }
        if (!isFinite(minX)) return; // ELK ничего не разложил

        const ox = box.x + SIDE - minX;
        const oy = box.y + TOP - minY;

        const deviceMoves = new Map<number, Point>();
        for (const c of subtreeCards) {
          const pos = laid.positions.get(c.id);
          if (pos) deviceMoves.set(c.id, { x: pos.x + ox, y: pos.y + oy });
        }
        const groupMoves = new Map<number, Box>();
        for (const [gid, subBox] of laid.boxes) {
          groupMoves.set(gid, {
            x: subBox.x + ox, y: subBox.y + oy,
            width: subBox.width, height: subBox.height,
          });
        }
        // Обновляем рамку самой группы по размаху её содержимого
        groupMoves.set(groupId, {
          ...box,
          width: Math.max(box.width, SIDE * 2 + (maxX - minX), GROUP_MIN.width),
          height: Math.max(box.height, TOP + (maxY - minY) + SIDE, GROUP_MIN.height),
        });

        history.push({
          title: 'раскладка группы',
          devices: [...deviceMoves]
            .map(([id, to]) => ({ id, from: placed.current.get(id), to }))
            .filter((move): move is { id: number; from: Point; to: Point } => move.from != null),
          groups: [...groupMoves]
            .map(([id, to]) => ({ id, from: boxesRef.current.get(id), to }))
            .filter((frame): frame is { id: number; from: Box; to: Box } => frame.from != null),
        });
        for (const [id, at] of deviceMoves) placed.current.set(id, at);
        savePositions([...deviceMoves].map(([id, at]) => ({ id, x: at.x, y: at.y })));
        for (const [id, frame] of groupMoves) {
          boxesRef.current.set(id, frame);
          saveGroupBox(id, frame);
        }
        setRedraw((n) => n + 1);
      } catch (error) {
        notifyError(error);
      } finally {
        layingGroups.current.delete(groupId);
      }
    },
    removeGroup: (groupId: number) => {
      const group = groups.find((g) => g.id === groupId);
      if (!group) return;
      if (!confirm(`Удалить группу «${group.name}»? Устройства останутся, подгруппы поднимутся на уровень выше.`)) return;
      deleteGroup.mutate(groupId, { onSuccess: () => notifySuccess('Группа удалена'), onError: notifyError });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [nodes, groups]);

  actionsRef.current = actions;

  const saveGroupBox = useCallback((groupId: number, box: Box) => {
    setGroupBox.mutate({ id: groupId, body: box }, { onError: notifyError });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Записать расположение узлов: по одному или всё сразу.
   *
   * Раскладка схемы двигает все узлы разом, и отдельный запрос на каждый —
   * это сотня запросов на одно нажатие кнопки. Одиночное перетаскивание так
   * и остаётся одиночным запросом: он короче и не тащит за собой список. */
  const savePositions = useCallback((moves: { id: number; x: number; y: number }[]) => {
    if (moves.length === 0) return;
    if (moves.length === 1) {
      updatePosition.mutate({ id: moves[0].id, body: { x: moves[0].x, y: moves[0].y } }, { onError: notifyError });
      return;
    }
    updatePositions.mutate(moves, { onError: notifyError });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Разослать координаты шага — в ту или другую сторону. */
  const applyStep = useCallback((step: LayoutStep, back: boolean) => {
    const moves = (step.devices ?? []).map((move) => {
      const at = back ? move.from : move.to;
      placed.current.set(move.id, at);
      return { id: move.id, x: at.x, y: at.y };
    });
    savePositions(moves);
    for (const frame of step.groups ?? []) {
      saveGroupBox(frame.id, back ? frame.from : frame.to);
    }
    setRedraw((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const history = useLayoutHistory(applyStep);

  /** Записать перемещение и разослать его. «Откуда» берётся из раскладки,
   * сложившейся к этому моменту. */
  const moveDevices = useCallback((moves: { id: number; x: number; y: number }[], title: string) => {
    const step: LayoutStep = {
      title,
      devices: moves
        .map((move) => ({ id: move.id, from: placed.current.get(move.id), to: { x: move.x, y: move.y } }))
        .filter((move): move is { id: number; from: Point; to: Point } => move.from != null),
    };
    history.push(step);
    for (const move of moves) placed.current.set(move.id, { x: move.x, y: move.y });
    savePositions(moves);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  /** Разложить всю схему по связям.
   *
   * Считает ELK в отдельном потоке, поэтому здесь ожидание — и поэтому же
   * раскладка живёт своей кнопкой, а не считается при отрисовке: рисовать
   * схему, дожидаясь раскладчика, значит показывать пустое полотно.
   *
   * Рамки групп записываются вместе с узлами: цех раскладывается как рамка
   * со своим содержимым, и оставить рамку на прежнем месте значит увезти
   * карточки из-под неё.
   */
  const [laying, setLaying] = useState(false);
  const relayoutAll = useCallback(async () => {
    if (nodes.length === 0 || laying) return;
    if (!confirm('Разложить схему по связям? Расположение узлов и рамки групп будут пересчитаны.')) return;
    setLaying(true);
    try {
      const sizes = nodeSizes(nodes.map((n) => cardText(n, look)), look);
      const card = nodeMetrics(look);
      const laid = await computeAutoLayout(
        nodes.map((n) => ({
          id: n.id,
          width: sizes.get(n.id)?.width ?? card.width,
          height: sizes.get(n.id)?.height ?? card.height,
          group: n.topology_group_id ?? null,
        })),
        groups,
        edges
          .filter((e) => e.device_a_id != null && e.device_b_id != null)
          .map((e) => ({ a: e.device_a_id!, b: e.device_b_id! })),
        { row: look.layoutRowGap, node: look.layoutNodeGap },
        look.layoutAlgorithm,
      );

      history.push({
        title: 'раскладка схемы',
        devices: [...laid.positions]
          .map(([id, to]) => ({ id, from: placed.current.get(id), to }))
          .filter((move): move is { id: number; from: Point; to: Point } => move.from != null),
        groups: [...laid.boxes]
          .map(([id, to]) => ({ id, from: boxesRef.current.get(id), to }))
          .filter((frame): frame is { id: number; from: Box; to: Box } => frame.from != null),
      });
      for (const [id, at] of laid.positions) placed.current.set(id, at);
      savePositions([...laid.positions].map(([id, at]) => ({ id, x: at.x, y: at.y })));
      for (const [id, box] of laid.boxes) {
        boxesRef.current.set(id, box);
        saveGroupBox(id, box);
      }
      // Схему после раскладки показываем целиком: она только что уехала
      // вся, и смотреть на прежний угол не на что.
      setRelayout((n) => n + 1);
    } catch (error) {
      notifyError(error);
    } finally {
      setLaying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, groups, look, laying, history]);

  const paper = useJointPaper({
    canEdit, scheme, background: look.background, actions: actionsRef, handlers,
  });

  handlers.current = {
    onConnect: (source: dia.Element, target: dia.Element) => {
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
    onLinkClick: (linkId) => setEditingLinkId(linkId),
    onDevicesMoved: (moves) => moveDevices(moves, moves.length > 1 ? 'перемещение группы узлов' : 'перемещение узла'),
    onGroupsMoved: (frames) => {
      const step = frames
        .map((frame) => ({ id: frame.id, from: boxesRef.current.get(frame.id), to: frame.box }))
        .filter((frame): frame is { id: number; from: Box; to: Box } => frame.from != null);
      history.push({ title: frames.length > 1 ? 'рамка группы с подгруппами' : 'рамка группы', groups: step });
      for (const frame of frames) {
        boxesRef.current.set(frame.id, frame.box);
        saveGroupBox(frame.id, frame.box);
      }
    },
    onDelete: (target, marked) => {
      const devices = [...marked.devices];
      const groupIds = [...marked.groups];
      // Выделенное рамкой — пачкой и с одним вопросом: спрашивать по разу на
      // каждую железку означает десять окон подряд, а на десятом человек
      // жмёт «да» не читая.
      if (devices.length + groupIds.length > 1) {
        // Про группы сказано отдельно: удаление рамки устройства не трогает,
        // и человек должен видеть, что за пачку он сносит.
        const parts = [
          devices.length ? `устройств: ${devices.length}` : null,
          groupIds.length ? `групп: ${groupIds.length} (устройства в них останутся)` : null,
        ].filter(Boolean).join(', ');
        if (!confirm(`Удалить ${parts}?`)) return;
        for (const id of devices) deleteDevice.mutate(id, { onError: notifyError });
        for (const id of groupIds) deleteGroup.mutate(id, { onError: notifyError });
        paper.clearMarked();
        return;
      }
      if (devices.length === 1) {
        actions.remove(devices[0]);
        paper.clearMarked();
        return;
      }
      if (groupIds.length === 1) {
        actions.removeGroup(groupIds[0]);
        paper.clearMarked();
        return;
      }
      if (!target) return;
      if (target.kind === 'device') actions.remove(target.id);
      else actions.removeGroup(target.id);
    },
  };

  const { holder, paperRef, graphRef, refreshTools } = paper;

  // ---------- наполнение ----------
  useEffect(() => {
    const graph = graphRef.current;
    const view = paperRef.current;
    if (!graph || !view) return;

    view.removeTools();
    highlighters.stroke.removeAll(view);
    graph.clear();
    if (nodes.length === 0) return;

    const positions = computePositions(nodes, edges, placed);
    const { deviceCells, boxes } = buildGraph(
      graph, { nodes, edges, groups }, { look, scheme, router: look.edgeRouter, positions },
    );
    boxesRef.current = boxes;

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

    // Панель действий и подсветка переживают перерисовку: ячейки создаются
    // заново, а выделенным остаётся то же устройство.
    refreshTools();

    // Вписывать содержимое в окно можно только тогда, когда человек этого
    // просит: схема перерисовывается на каждое изменение данных, и подгонка
    // масштаба на каждое из них выглядела как прыжок всей схемы под руками —
    // особенно заметный после перетаскивания рамки группы.
    if (graph.getCells().length > 0 && fitted.current !== relayout) {
      fitted.current = relayout;
      view.transformToFitContent({ padding: 60, maxScale: 1.1, useModelGeometry: true });
    }

    // Пришли по ссылке с карточки устройства — показываем именно его.
    const focusId = searchParams.get('device');
    if (focusId) {
      const cell = deviceCells.get(parseInt(focusId, 10));
      if (cell) {
        view.transformToFitContent({
          contentArea: cell.getBBox().inflate(320), maxScale: 1.4, useModelGeometry: true,
        });
        highlighters.stroke.add(cell.findView(view) as dia.ElementView, 'body', 'focused', {
          padding: 3, rx: 12, ry: 12, attrs: { stroke: '#1971c2', 'stroke-width': 2 },
        });
      }
      const rest = new URLSearchParams(searchParams);
      rest.delete('device');
      setSearchParams(rest, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, groups, look, relayout, redraw, canEdit, scheme]);

  // Ctrl+Z и Ctrl+Shift+Z — там же, где они везде. Внутри полей ввода не
  // перехватываются: там своя отмена, и она нужнее.
  useEffect(() => {
    if (!canEdit) return;
    function onKey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      const active = document.activeElement;
      if (active && ['INPUT', 'TEXTAREA'].includes(active.tagName)) return;
      event.preventDefault();
      if (event.shiftKey) history.redo();
      else history.undo();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit, history]);

  /** Новое устройство появляется в середине видимой области — если только
   * это не копия: та встаёт рядом с оригиналом, чтобы не искать её потом по
   * всей схеме. */
  function placeNewDevice(deviceId: number, request: AddDeviceRequest | null) {
    const near = request?.placeNear != null ? placed.current.get(request.placeNear) : null;
    if (near) {
      updatePosition.mutate({ id: deviceId, body: { x: near.x + 60, y: near.y + 90 } });
      return;
    }
    const view = paperRef.current;
    if (!view) return;
    const area = view.getArea();
    updatePosition.mutate({ id: deviceId, body: { x: area.x + area.width / 2, y: area.y + area.height / 2 } });
  }

  return (
    // Высота задаётся от окна, а не «сто процентов»: у родителя своей
    // высоты нет, и проценты от неё ничего не значат — полотно оставалось бы
    // на своих шестистах пикселях.
    <Stack gap="sm" style={{ height: 'calc(100vh - 2 * var(--app-shell-padding, 16px))' }}>
      <Group justify="space-between">
        <Title order={2}>Схема связей</Title>
        <Group>
          <Select
            placeholder="Все теги" clearable w={180}
            data={flattenTagsOrdered(tags).map(({ tag, depth }) => ({
              value: String(tag.id), label: `${'—'.repeat(depth)} ${tag.name}`,
            }))}
            value={tagFilter} onChange={setTagFilter}
          />
          {/* Способ разводки — такая же настройка вида, как заливка групп:
              хранится в браузере и переживает перезагрузку. Раньше он жил
              только в состоянии страницы и сбрасывался на «ортогонально»
              при каждом заходе. */}
          <SegmentedControl
            size="xs" value={look.edgeRouter}
            onChange={(value) => changeLook({ ...look, edgeRouter: value as 'orthogonal' | 'straight' })}
            data={[{ value: 'orthogonal', label: 'Ортогонально' }, { value: 'straight', label: 'Прямыми' }]}
          />
          {canEdit && (
            <Button variant="light" leftSection={<IconUsersGroup size={16} />} onClick={() => setGroupsModalOpen(true)}>
              Группы
            </Button>
          )}
          {canEdit && (
            <Button.Group>
              <Button
                variant="default" px={10} disabled={!history.canUndo}
                title={history.canUndo ? `Отменить: ${history.canUndo} (Ctrl+Z)` : 'Отменять нечего'}
                onClick={history.undo}
              >
                <IconArrowBackUp size={16} />
              </Button>
              <Button
                variant="default" px={10} disabled={!history.canRedo}
                title={history.canRedo ? `Вернуть: ${history.canRedo} (Ctrl+Shift+Z)` : 'Возвращать нечего'}
                onClick={history.redo}
              >
                <IconArrowForwardUp size={16} />
              </Button>
            </Button.Group>
          )}
          <Popover width={420} position="bottom-end" shadow="md" withArrow>
            <Popover.Target>
              <Button variant="default" px={10} title="Как пользоваться схемой">
                <IconHelp size={16} />
              </Button>
            </Popover.Target>
            <Popover.Dropdown>
              <Text size="sm">
                <b>Кнопки мыши.</b> Средняя — только навигация: тяните ей схему в любом месте, хоть по пустому,
                хоть поверх узлов; колесо меняет масштаб вокруг курсора. Левая — работа с объектами: клик выделяет,
                тяга двигает, а растяжка по пустому месту обводит рамкой несколько объектов сразу. Правая
                показывает панель действий у того, на чём стоит курсор; Escape или щелчок правой по пустому месту
                её убирают.
                <br /><br />
                <b>Панель узла:</b> править, копировать, в группу, удалить и разъём — от него тянут кабель на другое
                устройство, порты выбираются в окне. <b>Панель рамки:</b> правка, раскладка содержимого, устройство
                и подгруппа внутрь, удаление; рамку растягивают за угол.
                <br /><br />
                «Разложить» расставляет всю схему по кабелям: ядро сети слева, за ним цеховые, за ними железки;
                рамки групп переезжают вместе со своим содержимым. Оранжевый кружок с «?» — свободный конец кабеля:
                его тянут на устройство, чтобы воткнуть в порт. Клик по линии открывает правку связи, Delete удаляет
                выделенное. Узел за рамку своей группы не выходит, а состав группы меняется только явно.
                {canEdit && ' Рамка выделения берёт и устройства, и группы; захваченная группа выделяется целиком,'
                  + ' а её содержимое отдельно не отмечается — двигая рамку, вы двигаете и всё внутри. Shift по'
                  + ' объекту добавляет его к выделенным или убирает. Ctrl+Z возвращает расположение назад,'
                  + ' Ctrl+Shift+Z — вперёд; заведение и удаление так не отменяются.'}
              </Text>
            </Popover.Dropdown>
          </Popover>
          <AppearanceMenu value={look} onChange={changeLook} />
          {/* Разложить и вписать — разные жесты: первое пересчитывает
              расположение узлов, второе только подгоняет масштаб под то,
              что уже разложено. Раньше это была одна кнопка, и вписать
              схему, не растеряв ручную раскладку, было нельзя. */}
          {canEdit && (
            <Button
              variant="default" leftSection={<IconLayoutDistributeHorizontal size={16} />}
              onClick={relayoutAll} loading={laying}
            >
              Разложить
            </Button>
          )}
          <Button
            variant="default" leftSection={<IconFocusCentered size={16} />}
            onClick={() => paperRef.current?.transformToFitContent({
              padding: 60, maxScale: 1.1, useModelGeometry: true,
            })}
          >
            Вписать
          </Button>
          {canEdit && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setAddingDevice({})}>
              Устройство
            </Button>
          )}
        </Group>
      </Group>

      {/* Полотно занимает всё, что осталось от экрана: схему рассматривают,
          и каждая строка под ней — это отрезанный кусок картинки. Подсказка
          переехала под «?» в панели: читают её один раз, а место она
          занимала всегда. */}
      <Paper withBorder style={{ flex: 1, minHeight: 320, overflow: 'hidden' }}>
        <div ref={holder} style={{ width: '100%', height: '100%' }} />
      </Paper>
      {paper.markedCount > 0 && (
        <Group gap="xs">
          <Text size="sm">Выделено: {paper.markedCount}</Text>
          <Button size="compact-xs" variant="subtle" onClick={paper.clearMarked}>снять выделение</Button>
        </Group>
      )}

      {groupsModalOpen && <TopologyGroupsModal onClose={() => setGroupsModalOpen(false)} />}
      {addingDevice && (
        <DeviceFormModal
          device={null} draft={addingDevice.draft}
          onCreated={(id) => placeNewDevice(id, addingDevice)}
          onClose={() => setAddingDevice(null)}
        />
      )}
      {editingDeviceId != null && (
        <DeviceModalById deviceId={editingDeviceId} onClose={() => setEditingDeviceId(null)} />
      )}
      {editingLinkId != null && (
        <LinkModalById linkId={editingLinkId} onClose={() => setEditingLinkId(null)} />
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
