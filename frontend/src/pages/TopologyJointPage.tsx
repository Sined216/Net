import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, Paper, SegmentedControl, Stack, Switch, Text, Title } from '@mantine/core';
import { IconFocusCentered, IconRefresh, IconZoomIn, IconZoomOut } from '@tabler/icons-react';
import { dia, shapes } from '@joint/core';
import { useDeviceTemplates, useLinkTemplates, useLinks, useTopologyDevices, useTopologyGroups } from '../api/hooks';
import { computeForceLayout, type LayoutNode, type Spring } from './topology/layout';
import type { DeviceOut, LinkOut, TopologyGroupOut } from '../api/types';

/** Проба JointJS на нашей схеме связей — чтобы посмотреть, как оно выглядит.
 *
 * Это макет, а не замена рабочей топологии: он только рисует. Ничего не
 * сохраняет, не создаёт и не удаляет — узел можно подвинуть, но положение
 * останется в браузере. Рабочая схема на React Flow не тронута и живёт
 * там же, где жила.
 *
 * Что здесь интересно посмотреть: ортогональная разводка линий (JointJS
 * умеет обводить кабели вокруг узлов — у React Flow это надо писать руками),
 * подписи прямо на линии и рамки цехов позади узлов.
 */

const NODE = { width: 186, height: 62 };
const EMPTY_LINKS: LinkOut[] = [];
const NEUTRAL = '#adb5bd';

/** Узел устройства: цветная полоса по модели, код, название и счётчик портов. */
const DeviceShape = dia.Element.define(
  'netdoc.Device',
  {
    size: NODE,
    attrs: {
      body: {
        width: 'calc(w)', height: 'calc(h)', rx: 10, ry: 10,
        fill: '#ffffff', stroke: '#dee2e6', strokeWidth: 1.5,
        filter: { name: 'dropShadow', args: { dx: 0, dy: 1, blur: 3, color: 'rgba(0,0,0,0.10)' } },
      },
      stripe: { width: 5, height: 'calc(h)', rx: 2.5, ry: 2.5, fill: NEUTRAL },
      code: { x: 16, y: 25, fontSize: 13, fontWeight: 700, fill: '#212529', fontFamily: 'inherit' },
      name: { x: 16, y: 43, fontSize: 11, fill: '#868e96', fontFamily: 'inherit' },
      ports: {
        x: 'calc(w-12)', y: 25, fontSize: 11, fontWeight: 600, textAnchor: 'end',
        fill: '#868e96', fontFamily: 'inherit',
      },
    },
  },
  {
    markup: [
      { tagName: 'rect', selector: 'body' },
      { tagName: 'rect', selector: 'stripe' },
      { tagName: 'text', selector: 'code' },
      { tagName: 'text', selector: 'name' },
      { tagName: 'text', selector: 'ports' },
    ],
  },
);

/** Рамка группы — просто прямоугольник позади узлов с подписью на контуре. */
const GroupShape = dia.Element.define(
  'netdoc.Group',
  {
    attrs: {
      body: {
        width: 'calc(w)', height: 'calc(h)', rx: 12, ry: 12,
        fill: 'rgba(77,171,247,0.06)', stroke: '#4dabf7', strokeWidth: 1.5,
      },
      label: {
        x: 14, y: 4, fontSize: 12, fontWeight: 600, fill: '#4dabf7', fontFamily: 'inherit',
      },
      labelBack: { x: 8, y: -9, height: 18, rx: 6, ry: 6, fill: '#ffffff' },
    },
  },
  {
    markup: [
      { tagName: 'rect', selector: 'body' },
      { tagName: 'rect', selector: 'labelBack' },
      { tagName: 'text', selector: 'label' },
    ],
  },
);

export function TopologyJointPage() {
  const { data: devices = [] } = useTopologyDevices();
  const { data: linkPage } = useLinks({ limit: 500 });
  const { data: templates = [] } = useDeviceTemplates();
  const { data: linkTemplates = [] } = useLinkTemplates();
  const { data: groups = [] } = useTopologyGroups();

  const holder = useRef<HTMLDivElement>(null);
  const paperRef = useRef<dia.Paper | null>(null);
  const graphRef = useRef<dia.Graph | null>(null);
  const [router, setRouter] = useState<'straight' | 'orthogonal'>('orthogonal');
  const [showLabels, setShowLabels] = useState(true);
  const [relayout, setRelayout] = useState(0);

  // Литерал `[]` создавал бы новый массив на каждый рендер, а эффект ниже
  // сравнивает зависимости по ссылке — схема пересобиралась бы бесконечно.
  const links = linkPage?.items ?? EMPTY_LINKS;

  // Полотно создаётся один раз: пересоздавать его на каждое изменение данных
  // значит терять и масштаб, и положение экрана.
  useEffect(() => {
    const element = holder.current;
    if (!element) return;

    // Размер задаётся числами, а не «100%»: JointJS считает преобразования
    // сразу при создании, и на контейнере нулевого размера получает
    // невырожденную матрицу — падает всё полотно целиком.
    const graph = new dia.Graph({}, { cellNamespace: shapes });
    // Своего элемента полотну не передаём, а подкладываем его собственный:
    // `paper.remove()` при размонтировании убирает именно тот узел, который
    // ему отдали, — а с ним уехал бы и наш контейнер, и после повторного
    // монтирования (в режиме разработки React делает это специально) рисовать
    // было бы уже некуда.
    const paper = new dia.Paper({
      model: graph,
      cellViewNamespace: shapes,
      width: Math.max(element.clientWidth, 320),
      height: Math.max(element.clientHeight, 320),
      gridSize: 10,
      drawGrid: { name: 'dot', args: { color: '#dee2e6' } },
      // Соединять и удалять здесь нельзя: это макет для просмотра.
      interactive: { linkMove: false, labelMove: false },
      defaultConnectionPoint: { name: 'boundary' },
    });

    element.appendChild(paper.el);
    paper.unfreeze();

    // Окно меняют — полотно должно занимать его целиком.
    const observer = new ResizeObserver(() => {
      paper.setDimensions(Math.max(element.clientWidth, 320), Math.max(element.clientHeight, 320));
    });
    observer.observe(element);

    // Панорама тягой за пустое место и масштаб колесом — то, чего от схемы
    // ждут в первую очередь.
    let panning: { x: number; y: number } | null = null;
    paper.on('blank:pointerdown', (event: dia.Event) => {
      panning = { x: event.clientX ?? 0, y: event.clientY ?? 0 };
    });
    paper.on('blank:pointermove cell:pointermove', (event: dia.Event) => {
      if (!panning) return;
      const translate = paper.translate();
      paper.translate(
        translate.tx + ((event.clientX ?? 0) - panning.x),
        translate.ty + ((event.clientY ?? 0) - panning.y),
      );
      panning = { x: event.clientX ?? 0, y: event.clientY ?? 0 };
    });
    paper.on('blank:pointerup cell:pointerup', () => { panning = null; });
    paper.on('blank:mousewheel cell:mousewheel', (...args: unknown[]) => {
      const delta = args[args.length - 1] as number;
      const scale = paper.scale().sx * (delta > 0 ? 1.1 : 0.9);
      paper.scale(Math.min(2.5, Math.max(0.2, scale)));
    });

    paperRef.current = paper;
    graphRef.current = graph;
    return () => {
      observer.disconnect();
      paper.remove();
      paperRef.current = null;
      graphRef.current = null;
    };
  }, []);

  // Наполнение: макету хватает полной перерисовки на изменение данных —
  // точечные обновления это уже работа, а не проба.
  useEffect(() => {
    const graph = graphRef.current;
    const paper = paperRef.current;
    if (!graph || !paper || devices.length === 0) return;

    graph.clear();
    const positions = layout(devices, links, relayout);

    const groupCells = buildGroups(groups, devices, positions);
    graph.addCells(groupCells);

    const cellById = new Map<number, dia.Element>();
    for (const device of devices) {
      const template = templates.find((t) => t.id === device.template_id);
      const at = positions.get(device.id)!;
      const connected = device.interfaces.filter((i) => i.link_id).length;
      const cell = new DeviceShape({
        position: { x: at.x - NODE.width / 2, y: at.y - NODE.height / 2 },
        attrs: {
          stripe: { fill: template?.color ?? NEUTRAL },
          code: { text: device.code },
          name: { text: cut(device.name || template?.name || '—', 24) },
          ports: { text: `${connected}/${device.interfaces.length}` },
        },
      });
      graph.addCell(cell);
      cellById.set(device.id, cell);
    }

    const deviceOfInterface = new Map<number, number>();
    for (const device of devices) for (const i of device.interfaces) deviceOfInterface.set(i.id, device.id);
    const portOfInterface = new Map<number, string>();
    for (const device of devices) for (const i of device.interfaces) portOfInterface.set(i.id, `№${i.port_number}`);

    for (const link of links) {
      if (link.interface_a_id == null || link.interface_b_id == null) continue;
      const source = cellById.get(deviceOfInterface.get(link.interface_a_id)!);
      const target = cellById.get(deviceOfInterface.get(link.interface_b_id)!);
      if (!source || !target) continue;

      const template = link.template_id ? linkTemplates.find((t) => t.id === link.template_id) : null;
      const cell = new shapes.standard.Link({
        source: { id: source.id },
        target: { id: target.id },
        router: router === 'orthogonal' ? { name: 'manhattan', args: { step: 20, padding: 18 } } : undefined,
        connector: { name: 'rounded', args: { radius: 8 } },
        attrs: {
          line: {
            stroke: template?.color ?? '#9aa1ab',
            strokeWidth: 2,
            strokeDasharray: template?.line_style === 'dashed' ? '7 5'
              : template?.line_style === 'dotted' ? '2 4' : undefined,
            targetMarker: null,
          },
        },
        labels: showLabels ? [
          portLabel(portOfInterface.get(link.interface_a_id) ?? '', 34),
          portLabel(portOfInterface.get(link.interface_b_id) ?? '', -34),
        ] : [],
      });
      graph.addCell(cell);
    }

    if (graph.getCells().length > 0) {
      paper.transformToFitContent({ padding: 60, maxScale: 1.2, useModelGeometry: true });
    }
  }, [devices, links, templates, linkTemplates, groups, router, showLabels, relayout]);

  return (
    <Stack h="100%" gap="sm">
      <Group justify="space-between">
        <Title order={2}>Топология на JointJS (проба)</Title>
        <Group>
          <SegmentedControl
            size="xs" value={router}
            onChange={(value) => setRouter(value as 'straight' | 'orthogonal')}
            data={[
              { value: 'orthogonal', label: 'Ортогонально' },
              { value: 'straight', label: 'Прямыми' },
            ]}
          />
          <Switch
            size="xs" label="Номера портов" checked={showLabels}
            onChange={(e) => setShowLabels(e.currentTarget.checked)}
          />
          <Button
            size="xs" variant="light" leftSection={<IconRefresh size={14} />}
            onClick={() => setRelayout((n) => n + 1)}
          >
            Разложить заново
          </Button>
          <Button
            size="xs" variant="default" leftSection={<IconFocusCentered size={14} />}
            onClick={() => paperRef.current?.transformToFitContent({ padding: 60, maxScale: 1.2, useModelGeometry: true })}
          >
            Вписать
          </Button>
          <Button size="xs" variant="default" onClick={() => zoom(paperRef.current, 1.2)}>
            <IconZoomIn size={14} />
          </Button>
          <Button size="xs" variant="default" onClick={() => zoom(paperRef.current, 1 / 1.2)}>
            <IconZoomOut size={14} />
          </Button>
        </Group>
      </Group>

      <Alert color="blue" variant="light" py="xs">
        Это макет для сравнения: он только показывает. Подвинуть узел можно, но положение никуда не
        сохраняется, а создавать и удалять здесь нечего — рабочая схема осталась на прежней вкладке
        «Топология».
      </Alert>

      <Paper withBorder style={{ height: 640, overflow: 'hidden' }}>
        <div ref={holder} style={{ width: '100%', height: '100%' }} />
      </Paper>

      <Text c="dimmed" size="sm">
        Главное отличие от нынешней схемы — ортогональная разводка: JointJS сам обводит кабели вокруг узлов
        и разносит параллельные линии. Подписи сидят на самой линии и поворачиваются вместе с ней. Рамки
        цехов рисуются позади узлов и считаются по их положению, как и на рабочей схеме.
      </Text>
    </Stack>
  );
}

function zoom(paper: dia.Paper | null, factor: number) {
  if (!paper) return;
  const next = Math.min(2.5, Math.max(0.2, paper.scale().sx * factor));
  paper.scale(next);
}

function cut(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** Подпись порта на линии: в нескольких десятках точек от своего конца, на
 * белой подложке. Целые числа JointJS понимает как расстояние в точках от
 * начала линии, отрицательные — от конца; доли (0..1) прижимали бы подпись
 * вплотную к узлу, где она наезжает на его угол. */
function portLabel(text: string, offset: number) {
  return {
    position: { distance: offset, offset: 0, args: { keepGradient: false } },
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

/** Раскладка: сохранённые в базе позиции, остальным — та же пружинная
 * симуляция, что и на рабочей схеме. «Разложить заново» пересчитывает всё. */
function layout(devices: DeviceOut[], links: LinkOut[], seed: number) {
  const nodes: LayoutNode[] = devices.map((d) => ({
    id: String(d.id),
    x: seed === 0 && d.topology_x != null ? d.topology_x : Math.random() * 1100,
    y: seed === 0 && d.topology_y != null ? d.topology_y : Math.random() * 700,
    vx: 0, vy: 0,
    fixed: seed === 0 && d.topology_x != null && d.topology_y != null,
  }));
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

  return new Map(nodes.map((n) => [parseInt(n.id, 10), { x: n.x, y: n.y }]));
}

/** Рамки цехов: своя, если её задавали руками, иначе по содержимому. */
function buildGroups(
  groups: TopologyGroupOut[],
  devices: DeviceOut[],
  positions: Map<number, { x: number; y: number }>,
): dia.Element[] {
  const cells: dia.Element[] = [];
  for (const group of groups) {
    const members = devices.filter((d) => d.topology_group_id === group.id);
    if (members.length === 0 && group.width == null) continue;

    let box;
    if (group.x != null && group.y != null && group.width != null && group.height != null) {
      box = { x: group.x, y: group.y, width: group.width, height: group.height };
    } else {
      const xs = members.map((d) => positions.get(d.id)!.x);
      const ys = members.map((d) => positions.get(d.id)!.y);
      const pad = 46;
      box = {
        x: Math.min(...xs) - NODE.width / 2 - pad,
        y: Math.min(...ys) - NODE.height / 2 - pad,
        width: Math.max(...xs) - Math.min(...xs) + NODE.width + pad * 2,
        height: Math.max(...ys) - Math.min(...ys) + NODE.height + pad * 2,
      };
    }

    const color = group.color ?? '#4dabf7';
    const cell = new GroupShape({
      position: { x: box.x, y: box.y },
      size: { width: box.width, height: box.height },
      attrs: {
        body: { stroke: color, fill: tint(color) },
        label: { text: group.name, fill: color },
        labelBack: { width: group.name.length * 7 + 14 },
      },
    });
    // Рамка не мешает работать с узлами и всегда лежит под ними.
    cell.set('z', -1);
    cells.push(cell);
  }
  return cells;
}

function tint(color: string): string {
  return `color-mix(in srgb, ${color} 6%, transparent)`;
}
