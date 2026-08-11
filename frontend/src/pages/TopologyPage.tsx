import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Group, Paper, SegmentedControl, Select, Stack, Text, Title, useComputedColorScheme,
} from '@mantine/core';
import {
  IconFocusCentered, IconLayoutDistributeHorizontal, IconPlus, IconUsersGroup,
} from '@tabler/icons-react';
import { useSearchParams } from 'react-router-dom';
import { highlighters, type dia } from '@joint/core';
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
import { AppearanceMenu } from './topology/AppearanceMenu';
import { loadAppearance, saveAppearance, type TopologyAppearance } from './topology/appearance';
import {
  buildGraph, computePositions, storedBox, type Box, type Point,
} from './topology/joint/buildGraph';
import {
  useJointPaper, type JointActions, type PaperHandlers,
} from './topology/joint/useJointPaper';
import { flattenTagsOrdered } from '../lib/utils';
import { notifyError, notifySuccess } from '../lib/notify';
import { useCan } from '../auth/permissions';
import type { DeviceOut, LinkOut, TopologyGroupOut } from '../api/types';

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
 * Здесь остались только три вещи: что показывать (запросы и отбор по тегу),
 * что делают кнопки, и какие окна открыты. Само полотно с его событиями
 * живёт в `joint/useJointPaper`, а превращение данных в ячейки — в
 * `joint/buildGraph`: раньше всё это лежало в одном файле на тысячу строк,
 * и правка расцветки кабеля соседствовала с правкой состояния окон.
 */

const EMPTY: never[] = [];
/** Запас у рамки, посчитанной по содержимому: внутри должно остаться место,
 * чтобы узлы можно было двигать. */
const GROUP_SLACK = 90;

export function TopologyPage() {
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

  // Полотно схемы — это фон страницы, поэтому подписи, врезки и кнопки
  // красятся от темы интерфейса, а не наугад.
  const scheme = useComputedColorScheme('light');
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

  /** Раскладка, сложившаяся в этой сессии: пересчитывать симуляцию на каждое
   * изменение данных значит гонять узлы по экрану под руками у человека. */
  const placed = useRef(new Map<number, Point>());
  const autoSaved = useRef(new Set<number>());
  /** Для какого по счёту «Вписать» уже подгоняли масштаб. −1 — ещё ни разу,
   * то есть первое наполнение схемы. */
  const fitted = useRef(-1);
  const [relayout, setRelayout] = useState(0);
  /** Свежие действия и обработчики для полотна: оно ставит их один раз, а
   * данные под ними меняются. */
  const actionsRef = useRef<JointActions>(null!);
  const handlers = useRef<PaperHandlers>(null!);

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

  const paper = useJointPaper({
    canEdit, scheme, background: look.background, actions: actionsRef, handlers,
  });
  const { holder, paperRef, graphRef, refreshTools } = paper;

  // ---------- наполнение ----------
  useEffect(() => {
    const graph = graphRef.current;
    const view = paperRef.current;
    if (!graph || !view) return;

    view.removeTools();
    highlighters.stroke.removeAll(view);
    graph.clear();
    if (filteredDevices.length === 0) return;

    const positions = computePositions(filteredDevices, links, placed, relayout);
    const { deviceCells, boxes } = buildGraph(
      graph,
      { devices: filteredDevices, links, groups, templates, types, linkTemplates },
      { look, scheme, router, positions },
    );

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
  }, [filteredDevices, links, templates, types, linkTemplates, groups, look, router, relayout, canEdit, scheme]);

  /** Новое устройство появляется в середине видимой области. */
  function placeNewDevice(deviceId: number) {
    const view = paperRef.current;
    if (!view) return;
    const area = view.getArea();
    updatePosition.mutate({ id: deviceId, body: { x: area.x + area.width / 2, y: area.y + area.height / 2 } });
  }

  return (
    <Stack h="100%" gap="sm">
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
          {/* Разложить и вписать — разные жесты: первое пересчитывает
              расположение узлов, второе только подгоняет масштаб под то,
              что уже разложено. Раньше это была одна кнопка, и вписать
              схему, не растеряв ручную раскладку, было нельзя. */}
          {canEdit && (
            <Button
              variant="default" leftSection={<IconLayoutDistributeHorizontal size={16} />}
              onClick={() => {
                if (!confirm('Разложить схему заново? Расположение узлов, выставленное руками, будет пересчитано.')) return;
                setRelayout((n) => n + 1);
              }}
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
