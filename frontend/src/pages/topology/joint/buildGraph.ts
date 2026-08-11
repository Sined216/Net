import { dia, shapes } from '@joint/core';
import { canvasColors, nodeColors, tint, type TopologyAppearance } from '../appearance';
import {
  DeviceShape, GroupShape, StubShape, GROUP_MIN, NEUTRAL, NODE, STUB_SIZE, withAlpha,
} from './shapes';
import { groupDepth } from '../groups';
import { computeForceLayout, type LayoutNode, type Spring } from '../layout';
import type { TopologyEdge, TopologyGroupOut, TopologyNode } from '../../../api/types';

/** Схема, присланная сервером, → ячейки полотна.
 *
 * Данные приходят уже в том виде, в каком схема их рисует: у карточки есть
 * цвет модели и дробь «подключено / всего», у линии — номера и подписи
 * портов на обоих концах. Собирать это в браузере из всех устройств
 * площадки со всеми портами больше не нужно, и здесь не осталось ни
 * поиска по спискам, ни подсчётов — только геометрия и оформление.
 */

export type Box = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };

/** Что рисуем. Узлы и линии — от сервера, рамки групп — свой справочник:
 * они правятся отдельно от устройств и на схеме живут своей жизнью. */
export interface GraphData {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  groups: TopologyGroupOut[];
}

/** Как рисуем: настройки вида, тема интерфейса, способ разводки и
 * расположение узлов. */
export interface GraphView {
  look: TopologyAppearance;
  scheme: 'light' | 'dark';
  router: 'orthogonal' | 'straight';
  positions: Map<number, Point>;
}

/** Что из построенного нужно странице дальше: по ячейке устройства она
 * наводится на него по ссылке, по рамкам — дозаписывает те, что ещё не
 * заданы руками. */
export interface BuiltGraph {
  deviceCells: Map<number, dia.Element>;
  boxes: Map<number, Box>;
}

/** Отступ от содержимого до рамки группы, посчитанной по нему. */
const GROUP_PADDING = 34;
type CanvasPaint = ReturnType<typeof canvasColors>;

export function buildGraph(graph: dia.Graph, data: GraphData, view: GraphView): BuiltGraph {
  const { nodes, edges, groups } = data;
  const { look, scheme, router, positions } = view;

  const colors = nodeColors(look.deviceDark, scheme);
  const paint = canvasColors(scheme);
  const boxes = computeBoxes(groups, nodes, positions);

  const groupCells = addGroups(graph, groups, nodes, boxes, look, paint);
  const deviceCells = addDevices(graph, nodes, positions, boxes, groupCells, look, colors);
  addLinks(graph, edges, deviceCells, look, paint, router);

  return { deviceCells, boxes };
}

/** Рамки групп. Идут первыми: JointJS рисует ячейки в порядке добавления, и
 * рамка, добавленная после узлов, накрыла бы их собой. */
function addGroups(
  graph: dia.Graph,
  groups: TopologyGroupOut[],
  nodes: TopologyNode[],
  boxes: Map<number, Box>,
  look: TopologyAppearance,
  paint: CanvasPaint,
): Map<number, dia.Element> {
  const cells = new Map<number, dia.Element>();
  const byDepth = [...groups].sort((a, b) => groupDepth(groups, a.id) - groupDepth(groups, b.id));
  for (const group of byDepth) {
    const box = boxes.get(group.id);
    if (!box) continue;
    const accent = group.color ?? '#4dabf7';
    const fade = [1, 0.6, 0.4][Math.min(groupDepth(groups, group.id), 2)];
    const inside = nodes.filter((n) => n.topology_group_id === group.id).length;
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
          fill: look.groupTitle === 'onFrame' ? paint.canvas : 'transparent',
          y: look.groupTitle === 'onFrame' ? -9 : 2,
        },
      },
    });
    graph.addCell(cell);
    cells.set(group.id, cell);

    const parentCell = group.parent_id != null ? cells.get(group.parent_id) : undefined;
    if (parentCell) parentCell.embed(cell);
  }
  return cells;
}

/** Карточки устройств. */
function addDevices(
  graph: dia.Graph,
  nodes: TopologyNode[],
  positions: Map<number, Point>,
  boxes: Map<number, Box>,
  groupCells: Map<number, dia.Element>,
  look: TopologyAppearance,
  colors: ReturnType<typeof nodeColors>,
): Map<number, dia.Element> {
  const cells = new Map<number, dia.Element>();
  for (const node of nodes) {
    const accent = node.color ?? NEUTRAL;
    const raw = positions.get(node.id)!;
    const groupCell = node.topology_group_id != null ? groupCells.get(node.topology_group_id) : undefined;
    const frame = node.topology_group_id != null ? boxes.get(node.topology_group_id) : undefined;
    // Узел не должен торчать из своей рамки. Перетаскивание за неё не
    // выпускает само полотно, но координаты, пришедшие из базы, оно не
    // подрезает: рамку могли сузить, а устройство — перенести в группу
    // из другого угла схемы.
    const at = clampToFrame({ x: raw.x - NODE.width / 2, y: raw.y - NODE.height / 2 }, frame);

    const cell = new DeviceShape({
      position: at,
      kind: 'device',
      deviceId: node.id,
      z: 10,
      attrs: {
        // Рамка-градиент по цвету модели.
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
        body: { fill: colors.fill },
        dot: { fill: accent },
        // Крупная строка — название железки, мелкая под ней — её код: на
        // схеме ищут «станок №7», а не «PLC-0002».
        title: { text: node.name || node.template_name || node.device_type || node.code, fill: colors.title },
        ports: {
          text: look.devicePorts ? `${node.ports_connected}/${node.ports_total}` : '',
          fill: node.ports_connected > 0 ? colors.portsBusy : colors.portsIdle,
        },
        subtitle: {
          text: look.deviceSubtitle ? node.code : '',
          fill: colors.subtitle,
        },
      },
    });
    graph.addCell(cell);
    cells.set(node.id, cell);

    if (groupCell) groupCell.embed(cell);
  }
  return cells;
}

/** Кабели: целые — между двумя карточками, повисшие концы — заглушкой под
 * своим устройством. */
function addLinks(
  graph: dia.Graph,
  edges: TopologyEdge[],
  deviceCells: Map<number, dia.Element>,
  look: TopologyAppearance,
  paint: CanvasPaint,
  router: 'orthogonal' | 'straight',
) {
  // Кабели, приходящие в одно устройство, должны входить в него в разных
  // точках, иначе при ортогональной разводке они ложатся друг на друга и
  // видно одну линию вместо пяти. Считаем каждому концу его номер у своей
  // железки и разносим точки входа по высоте узла.
  const endsOfDevice = new Map<number, number[]>();
  for (const edge of edges) {
    for (const deviceId of [edge.device_a_id, edge.device_b_id]) {
      if (deviceId == null) continue;
      if (!endsOfDevice.has(deviceId)) endsOfDevice.set(deviceId, []);
      endsOfDevice.get(deviceId)!.push(edge.link_id);
    }
  }
  const anchorFor = (deviceId: number, linkId: number) => {
    const ends = endsOfDevice.get(deviceId) ?? [];
    const index = ends.indexOf(linkId);
    const spread = Math.min(ends.length, 5);
    const dy = spread <= 1 ? 0 : ((index % spread) - (spread - 1) / 2) * 18;
    return { name: 'center', args: { dy } };
  };
  // Коридоры разводки тоже разные: одинаковый отступ сводит соседние кабели
  // в одну линию ровно так же, как одинаковая точка входа. Шаг подобран так,
  // чтобы соседние коридоры было видно как отдельные, а не как утолщённую
  // линию.
  const linkOrder = new Map(edges.map((e, index) => [e.link_id, index]));
  const routerFor = (linkId: number) => (router === 'orthogonal'
    ? { name: 'manhattan', args: { step: 16, padding: 22 + ((linkOrder.get(linkId) ?? 0) % 4) * 18 } }
    : undefined);
  // Пересечения показываем «мостиком»: без него две пересекающиеся линии
  // читаются как одна с ответвлением.
  const connectorFor = () => (router === 'orthogonal'
    ? { name: 'jumpover', args: { size: 5, jump: 'arc' } }
    : { name: 'rounded', args: { radius: 8 } });
  // При ортогональной разводке линия обходит узлы стороной, поэтому её можно
  // класть поверх карточек — иначе подписи портов у самого узла прячутся под
  // ним. Прямая линия узлы пересекает, и там она остаётся под ними.
  const linkZ = router === 'orthogonal' ? 20 : 5;

  for (const edge of edges) {
    // Оба конца на месте — обычный кабель.
    if (edge.device_a_id != null && edge.device_b_id != null) {
      const source = deviceCells.get(edge.device_a_id);
      const target = deviceCells.get(edge.device_b_id);
      if (!source || !target) continue;
      graph.addCell(new shapes.standard.Link({
        source: { id: source.id, anchor: anchorFor(edge.device_a_id, edge.link_id) },
        target: { id: target.id, anchor: anchorFor(edge.device_b_id, edge.link_id) },
        linkId: edge.link_id,
        router: routerFor(edge.link_id),
        connector: connectorFor(),
        z: linkZ,
        attrs: {
          line: {
            stroke: edge.color ?? '#9aa1ab',
            strokeWidth: look.edgeWidth,
            strokeDasharray: edge.line_style === 'dashed' ? '7 5'
              : edge.line_style === 'dotted' ? '2 4' : undefined,
            opacity: edge.confirmed ? 0.9 : 0.45,
            targetMarker: null,
          },
        },
        labels: look.edgeLabels ? [
          portLabelCell(portText(edge.port_a_number, edge.interface_a_label, look), paint, true,
                        labelShift(endsOfDevice.get(edge.device_a_id), edge.link_id)),
          portLabelCell(portText(edge.port_b_number, edge.interface_b_label, look), paint, false,
                        labelShift(endsOfDevice.get(edge.device_b_id), edge.link_id)),
        ] : [],
      }));
      continue;
    }

    // Один конец повис: рисуем заглушку под живым устройством — кабель
    // никуда не делся, его просто некуда воткнуть.
    const liveIsA = edge.device_a_id != null;
    const liveDevice = liveIsA ? edge.device_a_id : edge.device_b_id;
    const deviceCell = liveDevice != null ? deviceCells.get(liveDevice) : undefined;
    if (!deviceCell) continue;

    const anchor = deviceCell.getBBox();
    const stub = new StubShape({
      position: { x: anchor.x + NODE.width / 2 - STUB_SIZE / 2, y: anchor.y + NODE.height + 42 },
      kind: 'stub',
      linkId: edge.link_id,
      z: 10,
      attrs: { body: { fill: paint.plate } },
    });
    graph.addCell(stub);
    graph.addCell(new shapes.standard.Link({
      source: { id: deviceCell.id }, target: { id: stub.id },
      linkId: edge.link_id,
      z: linkZ,
      attrs: {
        line: {
          stroke: '#f76707', strokeWidth: look.edgeWidth, strokeDasharray: '4 4',
          opacity: 0.9, targetMarker: null,
        },
      },
      labels: look.edgeLabels ? [
        // У повисшего кабеля живой конец всегда со стороны устройства:
        // заглушка — это второй конец, и подписывать там нечего.
        portLabelCell(
          liveIsA ? portText(edge.port_a_number, edge.interface_a_label, look)
                  : portText(edge.port_b_number, edge.interface_b_label, look),
          paint, true,
        ),
      ] : [],
    }));
  }
}

/** Сдвиг подписи поперёк линии: у устройства с несколькими кабелями подписи
 * сходятся в одну точку и наезжают друг на друга. */
function labelShift(ends: number[] | undefined, linkId: number): number {
  if (!ends || ends.length <= 1) return 0;
  const index = ends.indexOf(linkId);
  return (index % 2 === 0 ? -1 : 1) * (10 + Math.floor(index / 2) * 4);
}

/** Загнать узел внутрь рамки: рамка — это область, за которую он не выходит. */
function clampToFrame(at: Point, frame: Box | undefined): Point {
  if (!frame) return at;
  const pad = 8;
  return {
    x: Math.min(Math.max(at.x, frame.x + pad), Math.max(frame.x + pad, frame.x + frame.width - NODE.width - pad)),
    y: Math.min(Math.max(at.y, frame.y + 24), Math.max(frame.y + 24, frame.y + frame.height - NODE.height - pad)),
  };
}

function portText(number: number | null | undefined, label: string | null | undefined,
                   look: TopologyAppearance): string {
  if (number == null) return '';
  return look.edgeLabelName && label ? `№${number} · ${label}` : `№${number}`;
}

/** Отступ подписи от своего конца линии.
 *
 * Подпись относится к порту, а порт — у железки, поэтому и стоять она должна
 * у железки. Раньше отступ был вдвое больше, и на коротком кабеле подписи
 * обоих концов сходились к середине — было не понять, которая чья. */
const LABEL_DISTANCE = 26;

/** Подпись конца кабеля. Целые числа JointJS понимает как расстояние в
 * точках от начала линии, а отрицательные — от конца; доли прижимали бы
 * подпись вплотную к узлу.
 *
 * Подложка с контуром обязательна: без неё номер порта ложится прямо на
 * линию и на фон полотна и читается только при удачном стечении цветов.
 * Размер ей задаётся по тексту (`ref` и `calc`) — без этого прямоугольник
 * остаётся нулевым и подложки не видно вовсе; ровно так она и не рисовалась,
 * хотя цвета ей были заданы. */
function portLabelCell(text: string, paint: CanvasPaint, atSource: boolean, offset = 0) {
  return {
    position: { distance: atSource ? LABEL_DISTANCE : -LABEL_DISTANCE, offset },
    attrs: {
      labelBody: {
        ref: 'labelText',
        x: 'calc(x-5)', y: 'calc(y-3)', width: 'calc(w+10)', height: 'calc(h+6)',
        fill: paint.plate, stroke: paint.plateBorder, strokeWidth: 1, rx: 4, ry: 4,
      },
      labelText: {
        text, fontSize: 10, fontWeight: 600, fill: paint.plateText, fontFamily: 'inherit',
        textAnchor: 'middle', textVerticalAnchor: 'middle',
      },
    },
    markup: [
      { tagName: 'rect', selector: 'labelBody' },
      { tagName: 'text', selector: 'labelText' },
    ],
  };
}

/** Рамка, заданная руками. */
export function storedBox(group: TopologyGroupOut): Box | null {
  if (group.x == null || group.y == null || group.width == null || group.height == null) return null;
  return { x: group.x, y: group.y, width: group.width, height: group.height };
}

/** Положение узлов: сохранённое в базе, затем сложившееся в этой сессии, и
 * только новым устройствам считается пружинная раскладка. */
export function computePositions(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  placed: React.RefObject<Map<number, Point>>,
  relayout: number,
): Map<number, Point> {
  const layout: LayoutNode[] = nodes.map((n) => {
    // Сложившееся в этой сессии важнее сохранённого: запись позиции нарочно
    // не обновляет схему (иначе она дёргалась бы на каждое перетаскивание),
    // поэтому в присланных узлах ещё лежат прежние координаты. Брать их
    // после перетаскивания рамки группы значило бы вернуть узлы туда, откуда
    // человек их только что увёз, — рамка уехала, а узлы прыгнули назад.
    const saved = relayout > 0 ? undefined
      : (placed.current!.get(n.id)
        ?? (n.topology_x != null && n.topology_y != null ? { x: n.topology_x, y: n.topology_y } : undefined));
    return {
      id: String(n.id),
      x: saved?.x ?? Math.random() * 1100,
      y: saved?.y ?? Math.random() * 700,
      vx: 0, vy: 0,
      fixed: saved != null,
    };
  });
  const byId = new Map(layout.map((n) => [n.id, n]));

  const springs: Spring[] = [];
  for (const edge of edges) {
    if (edge.device_a_id == null || edge.device_b_id == null) continue;
    const a = byId.get(String(edge.device_a_id));
    const b = byId.get(String(edge.device_b_id));
    if (a && b && a !== b) springs.push({ a, b, idealLen: 240, strength: 0.02 });
  }
  if (layout.some((n) => !n.fixed)) computeForceLayout(layout, springs, 1100, 750);

  const result = new Map<number, Point>();
  for (const node of layout) {
    const at = { x: node.x, y: node.y };
    result.set(parseInt(node.id, 10), at);
    placed.current!.set(parseInt(node.id, 10), at);
  }
  return result;
}

/** Рамки групп: заданная руками, иначе — по содержимому. */
export function computeBoxes(
  groups: TopologyGroupOut[],
  nodes: TopologyNode[],
  positions: Map<number, Point>,
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
    for (const node of nodes) {
      if (node.topology_group_id !== group.id) continue;
      const at = positions.get(node.id);
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
