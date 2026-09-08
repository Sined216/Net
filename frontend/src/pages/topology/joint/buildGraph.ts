import { dia, shapes } from '@joint/core';
import { canvasColors, nodeColors, type LinkSide, type TopologyAppearance } from '../appearance';
import {
  CARD_LINES, DeviceShape, StubShape, NEUTRAL, nodeMetrics, nodeSizes, STUB_SIZE, withAlpha,
  type NodeSize,
} from './shapes';
import { NO_SNAP, snapPoint, snapStep } from '../grid';
import { computeForceLayout, type LayoutNode, type Spring } from '../layout';
import type { TopologyEdge, TopologyNode } from '../../../api/types';

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

/** Что рисуем: узлы и линии, как их прислал сервер. */
export interface GraphData {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

/** Как рисуем: настройки вида, тема интерфейса и расположение узлов. */
export interface GraphView {
  look: TopologyAppearance;
  scheme: 'light' | 'dark';
  positions: Map<number, Point>;
}

/** Что из построенного нужно странице дальше: по ячейке устройства она
 * наводится на него по ссылке. */
export interface BuiltGraph {
  deviceCells: Map<number, dia.Element>;
}

/** Что написано на карточке: крупная строка, счётчик портов и строки под
 * названием. Считается в одном месте, потому что нужно дважды — нарисовать и
 * померить, под какую ширину карточка. */
export function cardText(node: TopologyNode, look: TopologyAppearance) {
  return {
    id: node.id,
    title: node.name || node.template_name || node.device_type || node.code,
    ports: look.devicePorts ? `${node.ports_connected}/${node.ports_total}` : '',
    // Порядок постоянный: код, адрес, модель, фирма. Пустое значение строку
    // не занимает — адрес управления заполнен далеко не у всякой железки.
    lines: [
      look.deviceSubtitle ? node.code : null,
      look.deviceIp ? node.management_ip : null,
      look.deviceTemplate ? node.template_name || node.device_type : null,
      look.deviceManufacturer ? node.manufacturer : null,
    ].filter((text): text is string => !!text),
  };
}

/** Сторона карточки, к которой прицепится кабель, — по тому же правилу,
 * что и якорь `midSide` в библиотеке. «Ближайшая» там считается по
 * расстоянию со знаком: партнёр ниже на 60 px, но в стороне на 110 — и
 * ближайшей окажется боковая сторона. Повторяем это здесь, чтобы роутер и
 * якорь говорили об одной и той же стороне.
 */
function anchorSide(from: Box, to: Box, mode: TopologyAppearance['anchorMode']): LinkSide {
  const point = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const cx = from.x + from.width / 2;
  const cy = from.y + from.height / 2;
  const beside = point.y > from.y && point.y < from.y + from.height;
  const above = point.x > from.x && point.x < from.x + from.width;
  switch (mode) {
    case 'horizontal':
      return point.x < cx ? 'left' : 'right';
    case 'vertical':
      return point.y < cy ? 'top' : 'bottom';
    case 'prefer-horizontal':
      return above ? (point.y < cy ? 'top' : 'bottom') : (point.x < cx ? 'left' : 'right');
    case 'prefer-vertical':
      return beside ? (point.x < cx ? 'left' : 'right') : (point.y < cy ? 'top' : 'bottom');
    default: {
      const distance: Record<LinkSide, number> = {
        left: point.x - from.x,
        right: from.x + from.width - point.x,
        top: point.y - from.y,
        bottom: from.y + from.height - point.y,
      };
      return (Object.keys(distance) as LinkSide[])
        .reduce((best, side) => (distance[side] < distance[best] ? side : best), 'left');
    }
  }
}

/** Наибольший угол поворота у обходчика: 45° — те самые косые куски. */
const METRO_TURN = 45;
/** Радиус скругления угла кабеля. Маленький намеренно: угол читается как
 * угол, а не как дуга. */
const CORNER_RADIUS = 2;

type CanvasPaint = ReturnType<typeof canvasColors>;

export function buildGraph(graph: dia.Graph, data: GraphData, view: GraphView): BuiltGraph {
  const { nodes, edges } = data;
  const { look, scheme, positions } = view;

  const colors = nodeColors(look.deviceDark, scheme);
  const paint = canvasColors(scheme);
  const card = nodeMetrics(look);
  const sizes = nodeSizes(nodes.map((n) => cardText(n, look)), look);

  const deviceCells = addDevices(graph, nodes, positions, look, colors, card, sizes);
  addLinks(graph, edges, deviceCells, look, paint);

  return { deviceCells };
}

/** Карточки устройств. */
function addDevices(
  graph: dia.Graph,
  nodes: TopologyNode[],
  positions: Map<number, Point>,
  look: TopologyAppearance,
  colors: ReturnType<typeof nodeColors>,
  card: ReturnType<typeof nodeMetrics>,
  sizes: Map<number, NodeSize>,
): Map<number, dia.Element> {
  const cells = new Map<number, dia.Element>();
  for (const node of nodes) {
    const accent = node.color ?? NEUTRAL;
    const raw = positions.get(node.id)!;
    const text = cardText(node, look);
    const lines = text.lines;
    const size = sizes.get(node.id) ?? { ...card, titleRoom: card.width - 74 };
    const at = { x: raw.x - size.width / 2, y: raw.y - size.height / 2 };

    const cell = new DeviceShape({
      position: at,
      size,
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
        // Крупная строка — название железки: на схеме ищут «станок №7», а
        // не «PLC-0002».
        // Кружок цвета модели, название и счётчик портов стоят на одной
        // средней линии — иначе при смене размера шрифта они разъезжаются.
        dot: { cy: card.titleY, fill: accent },
        title: {
          text: text.title,
          fill: colors.title,
          y: card.titleY,
          fontSize: look.deviceTitleSize,
          fontWeight: look.deviceTitleWeight,
          textWrap: { width: size.titleRoom, maxLineCount: 1, ellipsis: true },
        },
        ports: {
          text: text.ports,
          fill: node.ports_connected > 0 ? colors.portsBusy : colors.portsIdle,
          y: card.titleY,
          fontSize: look.deviceLineSize,
          fontWeight: 600,
        },
        ...lineAttrs(lines, card, look, colors.subtitle),
      },
    });
    graph.addCell(cell);
    cells.set(node.id, cell);
  }
  return cells;
}

/** Кабели: целые — между двумя карточками, повисшие концы — заглушкой под
 * своим устройством.
 *
 * Как ведётся линия и чем она нарисована, настройками больше не являются:
 * обход чужих карточек, косые куски и скруглённый угол выбраны один раз,
 * на живой схеме, против всех прочих вариантов. Настройками остались
 * только те числа, что и правда зависят от конкретной сети, — ширина
 * коридоров, стороны выхода, крепление кабеля к карточке. */
function addLinks(
  graph: dia.Graph,
  edges: TopologyEdge[],
  deviceCells: Map<number, dia.Element>,
  look: TopologyAppearance,
  paint: CanvasPaint,
) {
  // Подписи портов у железки с несколькими кабелями сходятся в одну точку и
  // наезжали бы друг на друга — их разносит labelShift ниже, для чего нужен
  // номер конца среди остальных кабелей той же железки. Точка входа самого
  // кабеля в карточку при этом не разносится: все кабели целятся в центр.
  const endsOfDevice = new Map<number, number[]>();
  for (const edge of edges) {
    for (const deviceId of [edge.device_a_id, edge.device_b_id]) {
      if (deviceId == null) continue;
      if (!endsOfDevice.has(deviceId)) endsOfDevice.set(deviceId, []);
      endsOfDevice.get(deviceId)!.push(edge.link_id);
    }
  }
  // Кабель кладётся поверх узлов: обход карточек он всё равно строит по
  // их контурам, и линия, прошедшая впритирку, под карточкой пропала бы.
  const linkZ = 20;

  // Разводка и начертание собираются из настроек вида: числа, которые
  // раньше стояли здесь, переехали в умолчания (`appearance.ts`), а сами
  // ручки — в панель «Разводка кабелей». Подбирать их всё равно приходится
  // глядя на свою схему, и делать это должен тот, кто на неё смотрит.
  //
  // Заглушка повисшего конца — не препятствие: она сама часть кабеля, а не
  // чужая карточка на пути.
  const notObstacles = ['netdoc.Stub'];
  // Пустой набор сторон библиотека понимает как «ни одной», а человек в
  // окне — как «любая»; переводим.
  const sidesOrAll = (sides: LinkSide[]) => (sides.length ? sides : ['top', 'right', 'bottom', 'left']);

  // Соседние кабели разносятся по разным коридорам: с одинаковым отступом
  // они лягут одной линией. Разброс маленький — препятствие раздувается на
  // величину отступа, и слишком большой закрывает проход между двумя
  // карточками совсем.
  const linkOrder = new Map(edges.map((edge, index) => [edge.link_id, index]));
  const routerFor = (linkId: number, from?: dia.Element, to?: dia.Element) => {
    const lane = (linkOrder.get(linkId) ?? 0) % 4;
    // Сторона выхода и сторона крепления считаются в библиотеке порознь:
    // якорь `midSide` берёт свою, роутер — свою из разрешённого набора, и
    // они расходятся. Видно это как «кабель вышел справа и сразу свернул
    // вниз»: нарисован он от правой стороны, а ведёт его роутер от нижней.
    // Поэтому, пока человек не задал стороны сам, выдаём роутеру ровно ту,
    // к которой прицепится кабель.
    const start = look.routerStartSides.length || !from || !to
      ? sidesOrAll(look.routerStartSides)
      : [anchorSide(from.getBBox(), to.getBBox(), look.anchorMode)];
    const end = look.routerEndSides.length || !from || !to
      ? sidesOrAll(look.routerEndSides)
      : [anchorSide(to.getBBox(), from.getBBox(), look.anchorMode)];
    return {
      // Обходчик один и выбору не подлежит — но подменять его на
      // `manhattan` тут было бы соблазнительно, поэтому: `metro` — не
      // «`manhattan` с углом 45°». Он подменяет ещё и набор шагов поиска,
      // добавляя к четырём прямым четыре косых (joint.js, config у metro),
      // и запасной путь у него тоже ломается под 45°. Одним углом косые не
      // убрать — он ограничивает поворот между шагами, а не сам набор;
      // прямые углы даёт только `manhattan`. Оба проверены на живой схеме,
      // и человек выбрал косые.
      name: 'metro',
      args: {
        step: look.routerStep,
        padding: look.routerPadding + lane * look.routerLaneSpread,
        maxAllowedDirectionChange: METRO_TURN,
        // Библиотечное умолчание, наружу не вынесено: проверено на живой
        // схеме — с нашими якорями (`midSide`, точка уже на стороне
        // карточки) переключение не меняет ни одного пути. Ручка, которая
        // ничего не делает, хуже её отсутствия.
        perpendicular: true,
        startDirections: start,
        endDirections: end,
        maximumLoops: look.routerMaxLoops,
        excludeTypes: notObstacles,
        // Без этого списка кабель считает препятствием и собственные же
        // концы: `ObstacleMap.build` в joint.js исключает из препятствий
        // только `excludeTypes` и `excludeEnds` — рамки-предки концов
        // линии (`excludedAncestors`) он находит сам, а вот сами
        // источник и цель остаются обычными элементами графа и, раздутые
        // на `padding`, обычными препятствиями. Заметно это было как
        // короткий лишний излом посреди почти прямого пролёта: точка
        // выхода и раздутый бокс, который ей, возможно, придётся обходить,
        // — буквально одна и та же карточка. На двух изолированных узлах
        // без единого стороннего объекта путь и так делал крюк ради обхода
        // самого себя (проверено: пик до 32 px там, где рядом нет вообще
        // ничего постороннего).
        excludeEnds: ['source', 'target'],
      },
    };
  };

  // Кабель цепляется к середине той стороны карточки, что обращена к другому
  // концу связи, а не к середине самой карточки. Дело не только в том, что
  // линия перестаёт выползать из-под карточки: от якоря роутер берёт сторону
  // выхода — он спрашивает у прямоугольника сторону, ближайшую к якорю, а
  // середина карточки 179×57 ближе всего к верху и низу всегда, куда бы ни
  // стояло второе устройство.
  const endAnchor = {
    name: 'midSide',
    args: { mode: look.anchorMode, padding: look.anchorPadding },
  };

  // Начертание одно: скруглённые углы малым радиусом. Остальные пять
  // (острые, плавная, дуга, отрезки с обработкой угла, мостики) стояли
  // ручкой в панели, были опробованы на живой схеме и сняты — держать
  // выбор ради выбора значит предлагать вернуться к худшему.
  const linkConnector = { name: 'rounded', args: { radius: CORNER_RADIUS } };

  // «Никогда» — подписей в модели вовсе нет, как и раньше. «При наведении»
  // — они есть, но прозрачные с самого начала; полотно показывает их по
  // событию мыши (см. `hoverLabels` в useJointPaper.ts), для чего кабелю и
  // нужна отметка. «Всегда» — обычные видимые подписи, никакой отметки не
  // требуется.
  const showLabels = look.edgeLabels !== 'never';
  const hoverOnly = look.edgeLabels === 'hover';

  for (const edge of edges) {
    // Оба конца на месте — обычный кабель.
    if (edge.device_a_id != null && edge.device_b_id != null) {
      const source = deviceCells.get(edge.device_a_id);
      const target = deviceCells.get(edge.device_b_id);
      if (!source || !target) continue;
      graph.addCell(new shapes.standard.Link({
        source: { id: source.id, anchor: endAnchor },
        target: { id: target.id, anchor: endAnchor },
        linkId: edge.link_id,
        hoverLabels: hoverOnly,
        router: routerFor(edge.link_id, source, target),
        connector: linkConnector,
        z: linkZ,
        attrs: {
          line: {
            stroke: edge.color ?? '#9aa1ab',
            strokeWidth: look.edgeWidth,
            strokeDasharray: edge.line_style === 'dashed' ? '7 5'
              : edge.line_style === 'dotted' ? '2 4' : undefined,
            // Полупрозрачная линия означала «связь не подтверждена». Пока
            // опроса сети нет, все связи заведены руками и подтверждены —
            // разной прозрачности было взяться неоткуда, а объяснять её
            // приходилось каждому. Признак остался в базе под этап 4.
            opacity: 0.9,
            targetMarker: null,
          },
        },
        labels: showLabels ? [
          portLabelCell(portText(edge.port_a_number, edge.interface_a_label, look), paint, true,
                        look.edgeLabelSize,
                        labelShift(endsOfDevice.get(edge.device_a_id), edge.link_id, look.edgeLabelSize), hoverOnly),
          portLabelCell(portText(edge.port_b_number, edge.interface_b_label, look), paint, false,
                        look.edgeLabelSize,
                        labelShift(endsOfDevice.get(edge.device_b_id), edge.link_id, look.edgeLabelSize), hoverOnly),
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
      position: { x: anchor.center().x - STUB_SIZE / 2, y: anchor.y + anchor.height + 42 },
      kind: 'stub',
      linkId: edge.link_id,
      z: 10,
      attrs: { body: { fill: paint.plate } },
    });
    graph.addCell(stub);
    // Отвес до заглушки настройкам разводки намеренно не подчиняется: это
    // короткий отрезок под собственной карточкой, обходить которому нечего,
    // а ломаная или дуга на нём читались бы как настоящий кабель куда-то в
    // сторону.
    graph.addCell(new shapes.standard.Link({
      source: { id: deviceCell.id, anchor: endAnchor }, target: { id: stub.id, anchor: endAnchor },
      linkId: edge.link_id,
      hoverLabels: hoverOnly,
      z: linkZ,
      attrs: {
        line: {
          stroke: '#f76707', strokeWidth: look.edgeWidth, strokeDasharray: '4 4',
          opacity: 0.9, targetMarker: null,
        },
      },
      labels: showLabels ? [
        // У повисшего кабеля живой конец всегда со стороны устройства:
        // заглушка — это второй конец, и подписывать там нечего.
        portLabelCell(
          liveIsA ? portText(edge.port_a_number, edge.interface_a_label, look)
                  : portText(edge.port_b_number, edge.interface_b_label, look),
          paint, true, look.edgeLabelSize, 0, hoverOnly,
        ),
      ] : [],
    }));
  }
}

/** Сдвиг подписи поперёк линии: у устройства с несколькими кабелями подписи
 * сходятся в одну точку и наезжают друг на друга.
 *
 * Шаг между соседними подписями одной стороны считается от размера самой
 * подписи (шрифт + отступы подложки, те же `calc(h+6)`, что и у неё), а не
 * фиксированным числом: было 4px на шаг, и уже на дюжине кабелей одной
 * железки («№24 · Порт 24» и следующая подпись) сходились внахлёст —
 * 4px меньше половины высоты даже самой мелкой подписи. */
function labelShift(ends: number[] | undefined, linkId: number, fontSize: number): number {
  if (!ends || ends.length <= 1) return 0;
  const index = ends.indexOf(linkId);
  const side = index % 2 === 0 ? -1 : 1;
  const lap = Math.floor(index / 2);
  const labelHeight = fontSize + 6;
  return side * (fontSize + 10 + lap * (labelHeight + 4));
}

/** Строки под названием — по местам, посчитанным заранее. Выключенные
 * остаются пустыми: убирать их из разметки нельзя, она общая на все узлы. */
function lineAttrs(
  lines: string[],
  card: ReturnType<typeof nodeMetrics>,
  look: TopologyAppearance,
  fill: string,
) {
  const attrs: Record<string, unknown> = {};
  for (let index = 0; index < CARD_LINES; index++) {
    const text = lines[index];
    attrs[`line${index + 1}`] = text
      ? {
        text,
        display: 'block',
        y: card.firstLineY + index * card.step,
        fontSize: look.deviceLineSize,
        fontWeight: look.deviceLineWeight,
        fill,
        // Длинное название модели обрезается по месту, а не по числу букв.
        textWrap: { width: -22, maxLineCount: 1, ellipsis: true },
      }
      // Выключенную строку прячем целиком. Видно её и так не было — на
      // пустой текст JointJS кладёт прозрачный дефис-заполнитель, — но
      // прятать то, чего не показываем, честнее, чем полагаться на это.
      : { text: '', display: 'none' };
  }
  return attrs;
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
function portLabelCell(
  text: string, paint: CanvasPaint, atSource: boolean, size: number, offset = 0,
  /** Подпись есть в модели с самого начала и в режиме «при наведении» —
   * иначе показывать её было бы нечем на первом же входе мыши. Прячется она
   * прозрачностью, а не удалением из разметки: `opacity`, в отличие от
   * `display`, не роняет размер, посчитанный от текста через `calc()`
   * у рамки под ним. */
  hidden = false,
) {
  return {
    position: { distance: atSource ? LABEL_DISTANCE : -LABEL_DISTANCE, offset },
    attrs: {
      labelBody: {
        ref: 'labelText',
        x: 'calc(x-5)', y: 'calc(y-3)', width: 'calc(w+10)', height: 'calc(h+6)',
        fill: paint.plate, stroke: paint.plateBorder, strokeWidth: 1, rx: 4, ry: 4,
        opacity: hidden ? 0 : 1, pointerEvents: hidden ? 'none' : 'auto',
      },
      labelText: {
        text, fontSize: size, fontWeight: 600, fill: paint.plateText, fontFamily: 'inherit',
        textAnchor: 'middle', textVerticalAnchor: 'middle',
        opacity: hidden ? 0 : 1, pointerEvents: 'none',
      },
    },
    markup: [
      { tagName: 'rect', selector: 'labelBody' },
      { tagName: 'text', selector: 'labelText' },
    ],
  };
}

/** Положение узлов: сохранённое в базе, затем сложившееся в этой сессии, и
 * только новым устройствам — пружинная симуляция.
 *
 * Раскладка по связям («Разложить») сюда не заходит намеренно: она считает
 * схему целиком и в отдельном потоке, то есть с ожиданием, а отрисовка
 * ждать не может. Страница вызывает её сама и кладёт результат в `placed` —
 * отсюда он и берётся, как любое другое положение. Здесь остаётся то, чего
 * раскладка по связям не умеет: поставить одну новую железку между
 * полусотней расставленных руками, не тронув их.
 */
export function computePositions(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  placed: React.RefObject<Map<number, Point>>,
  /** Настройки вида — ради шага привязки. Привязываются только те узлы,
   * место которым придумала пружинная раскладка: сохранённые позиции не
   * трогаются, их поставил человек, и подвинуть их при открытии схемы
   * значило бы молча переставить чужую работу. */
  look?: TopologyAppearance,
): Map<number, Point> {
  const layout: LayoutNode[] = nodes.map((n) => {
    // Сложившееся в этой сессии важнее сохранённого: запись позиции нарочно
    // не обновляет схему (иначе она дёргалась бы на каждое перетаскивание),
    // поэтому в присланных узлах ещё лежат прежние координаты.
    const saved = placed.current!.get(n.id)
      ?? (n.topology_x != null && n.topology_y != null ? { x: n.topology_x, y: n.topology_y } : undefined);
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

  // Здесь координата — середина карточки, её и округляем: к середине
  // цепляется кабель, и от неё зависит, пойдёт он между двумя устройствами
  // прямо или с изломом.
  const step = look ? snapStep(look) : NO_SNAP;

  const result = new Map<number, Point>();
  for (const node of layout) {
    const id = parseInt(node.id, 10);
    const at = node.fixed ? { x: node.x, y: node.y } : snapPoint({ x: node.x, y: node.y }, step);
    result.set(id, at);
    placed.current!.set(id, at);
  }
  return result;
}
