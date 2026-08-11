import { dia, shapes } from '@joint/core';
import { canvasColors, nodeColors, tint, type TopologyAppearance } from '../appearance';
import {
  DeviceShape, GroupShape, StubShape, GROUP_MIN, NEUTRAL, NODE, STUB_SIZE, withAlpha,
} from './shapes';
import { groupDepth } from '../groups';
import { computeForceLayout, type LayoutNode, type Spring } from '../layout';
import type {
  DeviceOut, DeviceTemplateOut, DeviceTypeOut, LinkOut, LinkTemplateOut, TopologyGroupOut,
} from '../../../api/types';

/** Данные схемы → ячейки полотна.
 *
 * Вынесено из страницы: там это была половина файла, и правка расцветки
 * кабеля соседствовала с правкой состояния окон. Здесь функция ничего не
 * знает ни про React, ни про запросы к серверу — ей отдают уже загруженные
 * списки и уже посчитанные координаты, а она наполняет граф.
 */

export type Box = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };

/** Что рисуем. */
export interface GraphData {
  devices: DeviceOut[];
  links: LinkOut[];
  groups: TopologyGroupOut[];
  templates: DeviceTemplateOut[];
  types: DeviceTypeOut[];
  linkTemplates: LinkTemplateOut[];
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
  const { devices, links, groups, templates, types, linkTemplates } = data;
  const { look, scheme, router, positions } = view;

  const colors = nodeColors(look.deviceDark, scheme);
  const paint = canvasColors(scheme);
  const boxes = computeBoxes(groups, devices, positions);

  const groupCells = addGroups(graph, groups, devices, boxes, look, paint);
  const deviceCells = addDevices(graph, devices, templates, types, positions, boxes, groupCells,
                                 look, colors);
  addLinks(graph, devices, links, linkTemplates, deviceCells, look, paint, router);

  return { deviceCells, boxes };
}

/** Рамки групп. Идут первыми: JointJS рисует ячейки в порядке добавления, и
 * рамка, добавленная после узлов, накрыла бы их собой. */
function addGroups(
  graph: dia.Graph,
  groups: TopologyGroupOut[],
  devices: DeviceOut[],
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
    const inside = devices.filter((d) => d.topology_group_id === group.id).length;
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
  devices: DeviceOut[],
  templates: DeviceTemplateOut[],
  types: DeviceTypeOut[],
  positions: Map<number, Point>,
  boxes: Map<number, Box>,
  groupCells: Map<number, dia.Element>,
  look: TopologyAppearance,
  colors: ReturnType<typeof nodeColors>,
): Map<number, dia.Element> {
  const cells = new Map<number, dia.Element>();
  for (const device of devices) {
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
        title: { text: device.name || template?.name || typeName || device.code, fill: colors.title },
        ports: {
          text: look.devicePorts ? `${connected}/${device.interfaces.length}` : '',
          fill: connected > 0 ? colors.portsBusy : colors.portsIdle,
        },
        subtitle: {
          text: look.deviceSubtitle ? device.code : '',
          fill: colors.subtitle,
        },
      },
    });
    graph.addCell(cell);
    cells.set(device.id, cell);

    if (groupCell) groupCell.embed(cell);
  }
  return cells;
}

/** Кабели: целые — между двумя карточками, повисшие концы — заглушкой под
 * своим устройством. */
function addLinks(
  graph: dia.Graph,
  devices: DeviceOut[],
  links: LinkOut[],
  linkTemplates: LinkTemplateOut[],
  deviceCells: Map<number, dia.Element>,
  look: TopologyAppearance,
  paint: CanvasPaint,
  router: 'orthogonal' | 'straight',
) {
  const deviceOfInterface = new Map<number, number>();
  const portOfInterface = new Map<number, { number: number; label: string }>();
  for (const device of devices) {
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
  // Коридоры разводки тоже разные: одинаковый отступ сводит соседние кабели
  // в одну линию ровно так же, как одинаковая точка входа. Шаг подобран так,
  // чтобы соседние коридоры было видно как отдельные, а не как утолщённую
  // линию.
  const linkOrder = new Map(links.map((l, index) => [l.id, index]));
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
          portLabelCell(portText(portOfInterface.get(link.interface_a_id!), look), paint, 46,
                        labelShift(endsOfDevice.get(aDevice), link.id)),
          portLabelCell(portText(portOfInterface.get(link.interface_b_id!), look), paint, -46,
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
      attrs: { body: { fill: paint.plate } },
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
        portLabelCell(portText(portOfInterface.get(liveInterface), look), paint, 34),
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

function portText(port: { number: number; label: string } | undefined, look: TopologyAppearance): string {
  if (!port) return '';
  return look.edgeLabelName && port.label ? `№${port.number} · ${port.label}` : `№${port.number}`;
}

/** Подпись конца кабеля: в нескольких десятках точек от своего конца линии.
 * Целые числа JointJS понимает как расстояние в точках от начала, а
 * отрицательные — от конца; доли прижимали бы подпись вплотную к узлу.
 *
 * Подложка с контуром обязательна: без неё номер порта ложится прямо на
 * линию и на фон полотна и читается только при удачном стечении цветов. */
function portLabelCell(text: string, paint: CanvasPaint, distance: number, offset = 0) {
  return {
    position: { distance, offset },
    attrs: {
      labelBody: {
        fill: paint.plate, stroke: paint.plateBorder, strokeWidth: 1, rx: 4, ry: 4,
      },
      labelText: { text, fontSize: 10, fontWeight: 600, fill: paint.plateText, fontFamily: 'inherit' },
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
  devices: DeviceOut[],
  links: LinkOut[],
  placed: React.RefObject<Map<number, Point>>,
  relayout: number,
): Map<number, Point> {
  const nodes: LayoutNode[] = devices.map((d) => {
    // Сложившееся в этой сессии важнее сохранённого: запись позиции нарочно
    // не обновляет список устройств (иначе схема дёргалась бы на каждое
    // перетаскивание), поэтому в нём ещё лежат прежние координаты. Брать их
    // после перетаскивания рамки группы значило бы вернуть узлы туда, откуда
    // человек их только что увёз, — рамка уехала, а узлы прыгнули назад.
    const saved = relayout > 0 ? undefined
      : (placed.current!.get(d.id)
        ?? (d.topology_x != null && d.topology_y != null ? { x: d.topology_x, y: d.topology_y } : undefined));
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

  const result = new Map<number, Point>();
  for (const node of nodes) {
    const at = { x: node.x, y: node.y };
    result.set(parseInt(node.id, 10), at);
    placed.current!.set(parseInt(node.id, 10), at);
  }
  return result;
}

/** Рамки групп: заданная руками, иначе — по содержимому. */
export function computeBoxes(
  groups: TopologyGroupOut[],
  devices: DeviceOut[],
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
