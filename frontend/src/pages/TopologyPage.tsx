import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Group, Paper, Popover, Select, Stack, Text, Title,
  useComputedColorScheme,
} from '@mantine/core';
import {
  IconArrowBackUp, IconArrowForwardUp, IconDeviceFloppy, IconFocusCentered, IconHelp,
  IconLayoutDistributeHorizontal, IconListTree, IconPlus, IconRoute, IconX,
} from '@tabler/icons-react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { highlighters, type dia } from '@joint/core';
import {
  useDeleteDevice, useTags, useTopology, useTopologyGroups, useUpdateDevicePosition,
  useUpdateDevicePositions, useVlans,
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
import { applyHighlight } from './topology/joint/highlight';
import { loadTreeOpen, saveTreeOpen, TreePanel } from './topology/TreePanel';
import { highlightFor, type TreeSelection } from './topology/tree';
import { flattenTagsOrdered } from '../lib/utils';
import { notifyError, notifySuccess } from '../lib/notify';
import { confirmAction } from '../lib/confirm';
import { useCan } from '../auth/permissions';

/** Схема связей.
 *
 * Умеет всё, ради чего на неё приходят: завести и править устройство,
 * протянуть кабель, подключить повисший конец, подвинуть, удалить.
 *
 * Сделана на JointJS. Был и второй вариант, на React Flow, — они какое-то
 * время жили рядом, чтобы выбрать; выбор сделан в пользу JointJS ради
 * ортогональной разводки, которая сама обводила кабели вокруг узлов, не
 * рисуя их напрямик через чужие карточки. Второй вариант удалён, чтобы схему
 * не приходилось чинить дважды.
 *
 * Рамок-кластеров вокруг устройств на полотне больше нет. Раньше рамка
 * ограничивала перетаскивание своим содержимым, тянула вложенные устройства
 * при переносе, встревала в авто-раскладку и в обходчик кабелей — четыре
 * разных места кода ради того, чем на практике почти не пользовались.
 * Группа как таковая никуда не делась — это по-прежнему поле устройства,
 * просто на этом полотне она больше не рисуется и не трогается.
 *
 * Саму схему собирает сервер: `GET /topology` отдаёт узлы и линии в том
 * виде, в каком они рисуются. Браузер не получает всю площадку со всеми
 * портами и не сшивает картинку сам — двадцать четыре тысячи вложенных
 * объектов на тысячу устройств ради дроби «1/4» на карточке и номера порта
 * у конца кабеля были бы лишними.
 *
 * Здесь остались только три вещи: что показывать, что делают кнопки и какие
 * окна открыты. Полотно с его событиями живёт в `joint/useJointPaper`, а
 * превращение присланной схемы в ячейки — в `joint/buildGraph`.
 *
 * Слева — панель с деревьями (`topology/TreePanel`): группы, теги, типы,
 * модели, VLAN, у каждого пять веток свой источник данных, но ни один не
 * тяжелее того, что уже загружено для самой схемы (`topology/tree.ts`).
 * Выбор ветки не трогает граф — только красит виды ячеек классом `picked`
 * (`joint/highlight.ts`), поэтому маршруты кабелей от переключения веток не
 * пересчитываются.
 */

const EMPTY: never[] = [];

interface AddDeviceRequest {
  draft?: DeviceDraft;
  placeNear?: number;
}

export function TopologyPage() {
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const { data: topology } = useTopology(tagFilter ? parseInt(tagFilter, 10) : null);
  const { data: tags = EMPTY } = useTags();
  const { data: groups = EMPTY } = useTopologyGroups();
  const { data: vlans = EMPTY } = useVlans();
  const nodes = topology?.nodes ?? EMPTY;
  const edges = topology?.edges ?? EMPTY;

  const [treeOpen, setTreeOpen] = useState(loadTreeOpen);
  const [picked, setPicked] = useState<TreeSelection | null>(null);
  const toggleTree = useCallback((open: boolean) => {
    setTreeOpen(open);
    saveTreeOpen(open);
    // Закрыли панель — подсветка на схеме больше не от чего объяснить,
    // снимаем её вместе с панелью, а не оставляем схему приглушённой без
    // видимой причины.
    if (!open) setPicked(null);
  }, []);

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

  /** Разложить всю схему по связям. */
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
      }));
      const laid = await computeAutoLayout(
        cards,
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
    onDelete: async (target, marked) => {
      const devices = [...marked.devices];
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
      if (!target) return;
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
    buildGraph(graph, { nodes, edges }, { look, scheme, positions });

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

  // Подсветка выбранной ветки дерева. Отдельным эффектом от наполнения
  // графа выше, но зависит от тех же данных и объявлен позже него — граф
  // успевает пересобраться первым, и виды ячеек, которым эта подсветка
  // расставляет классы, уже существуют. При смене только выбора (без
  // пересборки графа) эффект тоже сработает — виды к тому моменту никуда
  // не делись, пересоздавать граф ради этого незачем.
  useEffect(() => {
    const view = paperRef.current;
    if (!view) return;
    applyHighlight(view, picked ? highlightFor(picked, nodes, edges, groups, tags) : null);
  }, [picked, nodes, edges, groups, tags, look, relayout, redraw, canEdit, scheme]);

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
        <Title order={2}>Схема связей</Title>
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
                <b>Кнопки мыши.</b> Средняя — только навигация: тяните ей схему в любом месте, хоть по пустому,
                хоть поверх узлов; колесо меняет масштаб вокруг курсора. Левая — работа с объектами: клик выделяет,
                тяга двигает, а растяжка по пустому месту обводит рамкой несколько объектов сразу. Правая
                показывает панель действий у того, на чём стоит курсор; Escape или щелчок правой по пустому месту
                её убирают.
                <br /><br />
                <b>Панель узла:</b> править, копировать, удалить и разъём — от него тянут кабель на другое
                устройство, порты выбираются в окне.
                <br /><br />
                «Разложить» расставляет всю схему по кабелям. Оранжевый кружок с «?» — свободный конец
                кабеля: его тянут на устройство, чтобы воткнуть в
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
            variant={treeOpen ? 'filled' : 'light'} leftSection={<IconListTree size={16} />}
            onClick={() => toggleTree(!treeOpen)}
          >
            Дерево
          </Button>
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

      <Group align="stretch" gap="sm" wrap="nowrap" style={{ flex: 1, minHeight: 320 }}>
        {treeOpen && (
          <TreePanel
            nodes={nodes} groups={groups} tags={tags} vlans={vlans}
            onSelect={setPicked} onClose={() => toggleTree(false)}
          />
        )}
        <Paper withBorder style={{ flex: 1, minHeight: 320, overflow: 'hidden' }}>
          <div ref={holder} style={{ width: '100%', height: '100%' }} />
        </Paper>
      </Group>
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
