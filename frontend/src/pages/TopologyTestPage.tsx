import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge, Button, Group, Paper, Popover, Select, Stack, Text, Title,
  useComputedColorScheme,
} from '@mantine/core';
import {
  IconArrowBackUp, IconArrowForwardUp, IconDeviceFloppy, IconFlask2, IconFocusCentered, IconHelp,
  IconLayoutDistributeHorizontal, IconPlus, IconRoute, IconX,
} from '@tabler/icons-react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { highlighters, type dia } from '@joint/core';
import {
  useDeleteDevice, useTags, useTopology, useUpdateDevicePosition, useUpdateDevicePositions,
} from '../api/hooks';
import * as apiEndpoints from '../api/endpoints';
import { ConnectPortsModal } from './topology/ConnectPortsModal';
import { AttachEndModal } from './topology/AttachEndModal';
import { DeviceModalById, LinkModalById } from './topology/OpenById';
import { DeviceFormModal, type DeviceDraft } from './devices/DeviceFormModal';
import { AppearanceMenu } from './topology/AppearanceMenu';
import { LinkRoutingPanel, loadRoutingOpen, saveRoutingOpen } from './topology/LinkRoutingPanel';
import { loadAppearance, saveAppearance, type TopologyAppearance } from './topology/appearance';
import {
  buildGraph, cardText, computePositions, type Point,
} from './topology/joint/buildGraph';
import { nodeMetrics, nodeSizes } from './topology/joint/shapes';
import { computeAutoLayout, type AutoCard } from './topology/layout';
import { snapStep } from './topology/grid';
import { useLayoutHistory, type LayoutStep } from './topology/joint/useLayoutHistory';
import {
  useJointPaper, type JointActions, type PaperHandlers,
} from './topology/joint/useJointPaper';
import { flattenTagsOrdered } from '../lib/utils';
import { notifyError, notifySuccess } from '../lib/notify';
import { confirmAction } from '../lib/confirm';
import { useCan } from '../auth/permissions';

/** Схема связей — тестовая копия без единого следа групп.
 *
 * Полная копия `TopologyPage.tsx`, сделанная не ради второй версии одного и
 * того же экрана, а как площадка: посмотреть на перетаскивание и авто-
 * раскладку, когда рамок-кластеров (`topology_group_id`) для этой страницы
 * вообще не существует. Устройство, у которого группа уже проставлена (оно
 * пришло с обычной топологии), здесь ведёт себя так, будто поля не было —
 * не встраивается в рамку, не подрезается ей, не участвует в кластеризации
 * ELK при «Разложить».
 *
 * Держится это не веткой `if (withGroups)` внутри одного файла, а тем, что
 * страница просто не запрашивает группы: `buildGraph`/`computeAutoLayout`
 * подмешивают группы к устройствам по спискам `groups`/`AutoCard.group`, и с
 * пустым списком/`null` подмешивать нечего — см. комментарии в
 * `joint/buildGraph.ts` (`addGroups`, `addDevices`, `computeBoxes`) и
 * `topology/layout.ts` (`computeAutoLayout`). Форк нужен только самой
 * странице: кнопкам, модалкам и состоянию работы с группами, которых здесь
 * попросту нет.
 *
 * Единственная дверь, которую пустой список сам не закрывает, — кнопка «В
 * группу» на панели устройства: она открывает окно, которое само читает и
 * пишет `/topology-groups`, в обход того, что знает эта страница. Закрыта
 * она через `groupsEnabled: false` у `useJointPaper` (см. `joint/tools.ts`,
 * `joint/useJointPaper.ts`) — без этого с тестовой страницы можно было бы
 * взаправду присвоить устройству группу, и оно тут же обзавелось бы рамкой
 * на обычной топологии.
 */

const EMPTY: never[] = [];

interface AddDeviceRequest {
  draft?: DeviceDraft;
  placeNear?: number;
}

export function TopologyTestPage() {
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const { data: topology } = useTopology(tagFilter ? parseInt(tagFilter, 10) : null);
  const { data: tags = EMPTY } = useTags();
  const nodes = topology?.nodes ?? EMPTY;
  const edges = topology?.edges ?? EMPTY;

  const canEdit = useCan('edit');
  const queryClient = useQueryClient();
  const updatePosition = useUpdateDevicePosition();
  const updatePositions = useUpdateDevicePositions();
  const deleteDevice = useDeleteDevice();

  const scheme = useComputedColorScheme('light');
  const [look, setLook] = useState<TopologyAppearance>(loadAppearance);
  const [addingDevice, setAddingDevice] = useState<AddDeviceRequest | null>(null);
  const [editingDeviceId, setEditingDeviceId] = useState<number | null>(null);
  const [editingLinkId, setEditingLinkId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState<{ sourceId: number; targetId: number } | null>(null);
  const [attaching, setAttaching] = useState<{ linkId: number; deviceId: number } | null>(null);
  const [routingOpen, setRoutingOpen] = useState(loadRoutingOpen);
  const toggleRouting = useCallback((open: boolean) => {
    setRoutingOpen(open);
    saveRoutingOpen(open);
  }, []);
  const [searchParams, setSearchParams] = useSearchParams();

  const placed = useRef(new Map<number, Point>());
  const fitted = useRef(-1);
  const [relayout, setRelayout] = useState(0);
  const [redraw, setRedraw] = useState(0);
  /** Несохранённые позиции устройств — то же, что в обычной топологии, но
   * без параллельной карты рамок: рамок здесь не бывает. */
  const pendingDevices = useRef(new Map<number, Point>());
  const [dirtyCount, setDirtyCount] = useState(0);
  const markDirty = useCallback(() => setDirtyCount(pendingDevices.current.size), []);
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
      try {
        const source = await queryClient.fetchQuery({
          queryKey: ['device', deviceId],
          queryFn: () => apiEndpoints.getDevice(deviceId),
        });
        setAddingDevice({
          draft: {
            template_id: source.template_id, name: source.name,
            role: source.role, notes: source.notes,
            // Группу источника сюда нарочно не тащим: этой странице она не
            // видна и не участвует ни в чём, копировать её значило бы
            // молча протащить то самое поле в обход собственного смысла
            // страницы.
            tag_ids: source.tags.map((t) => t.id),
          },
          placeNear: deviceId,
        });
      } catch (error) {
        notifyError(error);
      }
    },
    remove: async (deviceId: number) => {
      const node = nodes.find((n) => n.id === deviceId);
      if (!node) return;
      if (!(await confirmAction(`Удалить устройство «${node.code}» вместе с портами и связями?`))) return;
      deleteDevice.mutate(deviceId, { onError: notifyError });
    },
    // Заглушки — не поведение, а соответствие общему типу `JointActions`.
    // Кнопка «В группу» скрыта (`groupsEnabled: false` у `useJointPaper`), а
    // панель рамки группы не может появиться вовсе — рамок на этой странице
    // не бывает физически, вызывать эти четыре действия неоткуда.
    regroup: () => {},
    editGroup: () => {},
    addSubgroup: () => {},
    addDeviceToGroup: () => {},
    removeGroup: () => {},
    layoutGroup: () => {},
  }), [nodes, queryClient, deleteDevice]);

  actionsRef.current = actions;

  const savePositions = useCallback((moves: { id: number; x: number; y: number }[]) => {
    for (const move of moves) pendingDevices.current.set(move.id, { x: move.x, y: move.y });
    markDirty();
  }, [markDirty]);

  const [savingLayout, setSavingLayout] = useState(false);
  const saveLayout = useCallback(async () => {
    const deviceMoves = [...pendingDevices.current].map(([id, at]) => ({ id, x: at.x, y: at.y }));
    if (deviceMoves.length === 0) return;
    setSavingLayout(true);
    try {
      if (deviceMoves.length === 1) {
        await updatePosition.mutateAsync({ id: deviceMoves[0].id, body: { x: deviceMoves[0].x, y: deviceMoves[0].y } });
      } else {
        await updatePositions.mutateAsync(deviceMoves);
      }
      pendingDevices.current.clear();
      setDirtyCount(0);
      notifySuccess('Расположение сохранено');
    } catch (error) {
      notifyError(error);
    } finally {
      setSavingLayout(false);
    }
  }, []);

  const applyStep = useCallback((step: LayoutStep, back: boolean) => {
    const moves = (step.devices ?? []).map((move) => {
      const at = back ? move.from : move.to;
      placed.current.set(move.id, at);
      return { id: move.id, x: at.x, y: at.y };
    });
    savePositions(moves);
    setRedraw((n) => n + 1);
  }, [savePositions]);

  const history = useLayoutHistory(applyStep);

  const discardLayout = useCallback(async () => {
    if (dirtyCount === 0) return;
    if (!(await confirmAction('Отменить несохранённые изменения расположения?'))) return;
    for (const id of pendingDevices.current.keys()) placed.current.delete(id);
    pendingDevices.current.clear();
    setDirtyCount(0);
    history.clear();
    setRedraw((n) => n + 1);
  }, [dirtyCount, history]);

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
  }, [history, savePositions]);

  /** Разложить всю схему по связям — плоско, без единой группы: каждая
   * карточка идёт в ELK как ни к чему не привязанная (`group: null`), даже
   * если у неё в базе стоит `topology_group_id`. */
  const [laying, setLaying] = useState(false);
  const relayoutAll = useCallback(async () => {
    if (nodes.length === 0 || laying) return;
    if (!(await confirmAction('Разложить схему по связям? Расположение узлов будет пересчитано.'))) return;
    setLaying(true);
    try {
      const sizes = nodeSizes(nodes.map((n) => cardText(n, look)), look);
      const card = nodeMetrics(look);
      const cards: AutoCard[] = nodes.map((n) => ({
        id: n.id,
        width: sizes.get(n.id)?.width ?? card.width,
        height: sizes.get(n.id)?.height ?? card.height,
        group: null,
      }));
      const laid = await computeAutoLayout(
        cards,
        [],
        edges
          .filter((e) => e.device_a_id != null && e.device_b_id != null)
          .map((e) => ({ a: e.device_a_id!, b: e.device_b_id! })),
        { row: look.layoutRowGap, node: look.layoutNodeGap },
        look.layoutAlgorithm,
        snapStep(look),
      );

      history.push({
        title: 'раскладка схемы',
        devices: [...laid.positions]
          .map(([id, to]) => ({ id, from: placed.current.get(id), to }))
          .filter((move): move is { id: number; from: Point; to: Point } => move.from != null),
      });
      for (const [id, at] of laid.positions) placed.current.set(id, at);
      savePositions([...laid.positions].map(([id, at]) => ({ id, x: at.x, y: at.y })));
      setRelayout((n) => n + 1);
    } catch (error) {
      notifyError(error);
    } finally {
      setLaying(false);
    }
  }, [nodes, edges, look, laying, history, savePositions]);

  const paper = useJointPaper({
    canEdit, scheme, background: look.background,
    gridSize: look.gridSize, gridSnap: look.gridSnap, connectionPoint: look.connectionPoint,
    actions: actionsRef, handlers,
    // Ни одной группы на этой странице нет и быть не может — панель узла
    // остаётся без кнопки «В группу» (см. шапку файла).
    groupsEnabled: false,
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
    // Рамок на этой странице нет — переехать им неоткуда, обработчик нужен
    // только чтобы удовлетворить тип `PaperHandlers`.
    onGroupsMoved: () => {},
    onDelete: async (target, marked) => {
      const devices = [...marked.devices];
      // `marked.groups` на этой странице гарантированно пуст: полотно ищет
      // рамкой только ячейки `kind === 'group'`, которых здесь не бывает.
      if (devices.length > 1) {
        if (!(await confirmAction(`Удалить устройств: ${devices.length}?`))) return;
        for (const id of devices) deleteDevice.mutate(id, { onError: notifyError });
        paper.clearMarked();
        return;
      }
      if (devices.length === 1) {
        actions.remove(devices[0]);
        paper.clearMarked();
        return;
      }
      if (!target || target.kind !== 'device') return;
      actions.remove(target.id);
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

    const positions = computePositions(nodes, edges, placed, look);
    buildGraph(graph, { nodes, edges, groups: EMPTY }, { look, scheme, positions });

    refreshTools();

    if (graph.getCells().length > 0 && fitted.current !== relayout) {
      fitted.current = relayout;
      view.transformToFitContent({ padding: 60, maxScale: 1.1, useModelGeometry: true });
    }

    const focusId = searchParams.get('device');
    if (focusId) {
      const deviceCells = new Map<number, dia.Element>();
      for (const cell of graph.getElements()) {
        if (cell.get('kind') === 'device') deviceCells.set(cell.get('deviceId'), cell);
      }
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
  }, [nodes, edges, look, relayout, redraw, canEdit, scheme]);

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

  useEffect(() => {
    if (dirtyCount === 0) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirtyCount]);

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
    <Stack gap="sm" style={{ height: 'calc(100vh - 2 * var(--app-shell-padding, 16px))' }}>
      <Group justify="space-between">
        <Group gap="xs">
          <Title order={2}>Схема связей</Title>
          <Badge size="sm" variant="light" color="grape" leftSection={<IconFlask2 size={12} />}>
            Тестовая страница — без групп
          </Badge>
        </Group>
        <Group>
          <Select
            placeholder="Все теги" clearable w={180}
            data={flattenTagsOrdered(tags).map(({ tag, depth }) => ({
              value: String(tag.id), label: `${'—'.repeat(depth)} ${tag.name}`,
            }))}
            value={tagFilter} onChange={setTagFilter}
          />
          {canEdit && dirtyCount > 0 && (
            <Button.Group>
              <Button
                leftSection={<IconDeviceFloppy size={16} />} onClick={saveLayout} loading={savingLayout}
                title={`Отправить на сервер: устройств — ${pendingDevices.current.size}`}
              >
                Сохранить
              </Button>
              <Button
                variant="default" px={10} onClick={discardLayout}
                title="Отменить несохранённые изменения расположения"
              >
                <IconX size={16} />
              </Button>
            </Button.Group>
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
                Та же схема связей, что и на «Топология», только без единого понятия группы: рамок-кластеров
                здесь не бывает, и устройство, у которого группа уже стоит в базе, ведёт себя так, будто поля
                нет вовсе — не встаёт в рамку, не подрезается ей и не собирается в свой кластер при
                «Разложить». Кнопки «Группы» и «В группу» с этой страницы убраны — присвоить группу отсюда
                нельзя, а значит и повлиять на обычную топологию тоже.
                <br /><br />
                <b>Кнопки мыши.</b> Средняя — только навигация: тяните ей схему в любом месте, хоть по пустому,
                хоть поверх узлов; колесо меняет масштаб вокруг курсора. Левая — работа с объектами: клик выделяет,
                тяга двигает, а растяжка по пустому месту обводит рамкой несколько объектов сразу. Правая
                показывает панель действий у того, на чём стоит курсор; Escape или щелчок правой по пустому месту
                её убирают.
                <br /><br />
                <b>Панель узла:</b> править, копировать, удалить и разъём — от него тянут кабель на другое
                устройство, порты выбираются в окне.
                <br /><br />
                «Разложить» расставляет всю схему по кабелям в общий ряд, без исключений для бывших групп.
                Оранжевый кружок с «?» — свободный конец кабеля: его тянут на устройство, чтобы воткнуть в
                порт. Клик по линии открывает правку связи, Delete удаляет выделенное.
                {canEdit && ' Рамка выделения захватывает устройства; Shift по объекту добавляет его к'
                  + ' выделенным или убирает.'}
                <br /><br />
                {canEdit && ('Расположение узлов — перетаскивание, растяжка, «Разложить» — сохраняется не '
                  + 'сразу: правки копятся на экране, кнопка «Сохранить» появляется, когда есть что отправить. '
                  + 'Рядом с ней — крестик, отменяющий несохранённое целиком; уйти со страницы или закрыть '
                  + 'вкладку с несохранённым браузер переспросит отдельно. Ctrl+Z и Ctrl+Shift+Z ходят по '
                  + 'шагам расположения независимо от сохранения. Заведение и удаление так не отменяются.')}
              </Text>
            </Popover.Dropdown>
          </Popover>
          <AppearanceMenu value={look} onChange={changeLook} />
          <Button
            variant={routingOpen ? 'filled' : 'light'} leftSection={<IconRoute size={16} />}
            onClick={() => toggleRouting(!routingOpen)}
          >
            Разводка
          </Button>
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

      <Paper withBorder style={{ flex: 1, minHeight: 320, overflow: 'hidden' }}>
        <div ref={holder} style={{ width: '100%', height: '100%' }} />
      </Paper>
      {paper.markedCount > 0 && (
        <Group gap="xs">
          <Text size="sm">Выделено: {paper.markedCount}</Text>
          <Button size="compact-xs" variant="subtle" onClick={paper.clearMarked}>снять выделение</Button>
        </Group>
      )}

      {routingOpen && (
        <LinkRoutingPanel value={look} onChange={changeLook} onClose={() => toggleRouting(false)} />
      )}
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
    </Stack>
  );
}
