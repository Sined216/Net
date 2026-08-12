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
  useCreateDevice, useDeleteDevice, useDeleteTopologyGroup, useSetTopologyGroupBox, useTags,
  useTopology, useTopologyGroups, useUpdateDevicePosition, useUpdateDevicePositions,
} from '../api/hooks';
import * as apiEndpoints from '../api/endpoints';
import { ConnectPortsModal } from './topology/ConnectPortsModal';
import { AttachEndModal } from './topology/AttachEndModal';
import { GroupEditModal } from './topology/GroupEditModal';
import { DeviceGroupModal } from './topology/DeviceGroupModal';
import { TopologyGroupsModal } from './topology/TopologyGroupsModal';
import { DeviceModalById, LinkModalById } from './topology/OpenById';
import { DeviceFormModal } from './devices/DeviceFormModal';
import { AppearanceMenu } from './topology/AppearanceMenu';
import { loadAppearance, saveAppearance, type TopologyAppearance } from './topology/appearance';
import {
  buildGraph, cardText, computePositions, layoutInsideGroup, storedBox, type Box, type Point,
} from './topology/joint/buildGraph';
import { nodeMetrics, nodeSizes } from './topology/joint/shapes';
import { computeAutoLayout } from './topology/layout';
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
  const createDevice = useCreateDevice();
  const deleteGroup = useDeleteTopologyGroup();
  const setGroupBox = useSetTopologyGroupBox();

  // Полотно схемы — это фон страницы, поэтому подписи, врезки и кнопки
  // красятся от темы интерфейса, а не наугад.
  const scheme = useComputedColorScheme('light');
  const [look, setLook] = useState<TopologyAppearance>(loadAppearance);
  const [addingDevice, setAddingDevice] = useState(false);
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
      try {
        const source = await queryClient.fetchQuery({
          queryKey: ['device', deviceId],
          queryFn: () => apiEndpoints.getDevice(deviceId),
        });
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
    layoutGroup: (groupId: number) => {
      const box = boxesRef.current.get(groupId);
      if (!box) return;
      // Порядок — тот, в котором устройства пришли с сервера (по коду):
      // повторное нажатие тогда даёт ту же раскладку, а не тасует карточки.
      const inside = nodes.filter((n) => n.topology_group_id === groupId).map((n) => n.id);
      if (inside.length === 0) return;
      const inner = groups
        .filter((g) => g.parent_id === groupId)
        .map((g) => boxesRef.current.get(g.id))
        .filter((b): b is Box => b != null);
      // Шаг решётки — по самой широкой карточке группы: карточки теперь
      // разной ширины, и класть их через шаг самой узкой значит наложить.
      const sizes = nodeSizes(nodes.map((n) => cardText(n, look)), look);
      const step = {
        width: Math.max(...inside.map((id) => sizes.get(id)?.width ?? 0), nodeMetrics(look).width),
        height: nodeMetrics(look).height,
      };
      const laid = layoutInsideGroup(box, inside, inner, step);
      const grown = laid.box !== box
        ? [{ id: groupId, from: box, to: laid.box }]
        : [];
      history.push({
        title: 'раскладка группы',
        devices: inside
          .map((id) => ({ id, from: placed.current.get(id), to: laid.positions.get(id)! }))
          .filter((move): move is { id: number; from: Point; to: Point } => move.from != null),
        groups: grown,
      });
      for (const [id, at] of laid.positions) placed.current.set(id, at);
      savePositions([...laid.positions].map(([id, at]) => ({ id, x: at.x, y: at.y })));
      if (grown.length) {
        boxesRef.current.set(groupId, laid.box);
        saveGroupBox(groupId, laid.box);
      }
      setRedraw((n) => n + 1);
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
    onDelete: (target, devices) => {
      // Выделенных рамкой — пачкой и с одним вопросом: спрашивать по разу на
      // каждую железку означает десять окон подряд, а на десятом человек
      // жмёт «да» не читая.
      if (devices.length > 1) {
        if (!confirm(`Удалить устройств: ${devices.length}? Вместе с их портами и связями.`)) return;
        for (const id of devices) deleteDevice.mutate(id, { onError: notifyError });
        paper.clearMarked();
        return;
      }
      if (devices.length === 1) {
        actions.remove(devices[0]);
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

  /** Новое устройство появляется в середине видимой области. */
  function placeNewDevice(deviceId: number) {
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
                Клик по узлу открывает панель: править, копировать, в группу, удалить и «протянуть кабель» — за
                последнюю кнопку тянут до другого устройства, а порты выбираются в окне. Клик по рамке группы — своя
                панель: правка, раскладка содержимого рядами, подгруппа, удаление; рамку двигают мышью и растягивают
                за угол. «Разложить» расставляет всю схему по кабелям: ядро сети слева, за ним цеховые, за ними
                железки; рамки групп переезжают вместе со своим содержимым. Оранжевый кружок с «?» — свободный конец кабеля: его тянут на устройство, чтобы воткнуть в
                порт. Клик по линии открывает правку связи, Delete удаляет выделенное. Узел за рамку своей группы не
                выходит, а состав группы меняется только явно.
                {canEdit && ' Shift с растяжкой по пустому месту выделяет несколько устройств рамкой, Shift по узлу'
                  + ' добавляет его к выделенным: дальше их двигают за любое из них и удаляют разом. Ctrl+Z'
                  + ' возвращает расположение назад, Ctrl+Shift+Z — вперёд; заведение и удаление так не отменяются.'}
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
            <Button leftSection={<IconPlus size={16} />} onClick={() => setAddingDevice(true)}>
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
      {paper.markedCount > 1 && (
        <Group gap="xs">
          <Text size="sm">Выделено устройств: {paper.markedCount}</Text>
          <Button size="compact-xs" variant="subtle" onClick={paper.clearMarked}>снять выделение</Button>
        </Group>
      )}

      {groupsModalOpen && <TopologyGroupsModal onClose={() => setGroupsModalOpen(false)} />}
      {addingDevice && (
        <DeviceFormModal device={null} onCreated={placeNewDevice} onClose={() => setAddingDevice(false)} />
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
