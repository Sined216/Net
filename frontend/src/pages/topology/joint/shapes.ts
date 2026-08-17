import { dia } from '@joint/core';
import type { TopologyAppearance } from '../appearance';

/** Фигуры схемы на JointJS: устройство, рамка группы и заглушка свободного
 * конца кабеля.
 *
 * Вынесены из страницы, потому что определяются один раз на всё приложение:
 * `dia.Element.define` регистрирует тип в пространстве имён, и повторный
 * вызов при каждом рендере плодил бы одинаковые типы.
 */

export const NODE_WIDTH = 178;
/** Размер карточки по умолчанию — им фигура объявляется; настоящий считается
 * по настройкам, потому что строк под названием бывает от нуля до трёх. */
export const NODE = { width: NODE_WIDTH, height: 62 };

/** Сколько строк под названием и где они стоят.
 *
 * Состав карточки — настройка: одному нужен код с наклейки, другому фирма и
 * модель. Поэтому и высота карточки не константа: три строки на карточке
 * высотой в одну — это наложение текста друг на друга, а пустая карточка на
 * три строки — дыра в схеме.
 */
export function nodeMetrics(look: TopologyAppearance) {
  const lines = [look.deviceSubtitle, look.deviceIp, look.deviceTemplate, look.deviceManufacturer]
    .filter(Boolean).length;
  const pad = 11;
  // Всё считается по середине строки, а не по базовой линии букв: от базовой
  // линии положение зависит ещё и от размера шрифта, и кружок цвета модели,
  // заданный отдельно, переставал совпадать с названием, стоило поменять его
  // размер.
  const titleY = pad + look.deviceTitleSize / 2;
  const step = look.deviceLineSize + 6;
  // Между названием и первой строкой — воздух: вплотную они читаются как
  // один абзац, а это разные вещи.
  const firstLineY = titleY + look.deviceTitleSize / 2 + 9 + look.deviceLineSize / 2;
  const height = lines
    ? firstLineY + (lines - 1) * step + look.deviceLineSize / 2 + pad
    : titleY + look.deviceTitleSize / 2 + pad;
  return { width: NODE_WIDTH, height, titleY, firstLineY, step, lines };
}
/** Ширина карточки: от и до.
 *
 * Меньше нижней границы карточка выглядит обрубком даже под коротким
 * именем, а верхняя не даёт одному длинному названию — а они бывают в
 * полстроки — растянуть карточку на пол-экрана и развалить всю раскладку.
 * За границей название по-прежнему обрезается многоточием.
 */
const WIDTH_LIMITS = { min: 150, max: 420 };

/** Ширина текста — как её посчитает браузер, а не «число букв на коэффициент».
 *
 * Коэффициент врёт: у кириллицы, латиницы и цифр разная ширина буквы, и
 * подобранный на глаз множитель оставляет то пустое поле, то обрезанный
 * хвост. Мерка одна на все замеры и живёт между вызовами: создавать канву на
 * каждую карточку — тысяча канв на тысячу устройств.
 */
let ruler: CanvasRenderingContext2D | null | undefined;

function textWidth(text: string, size: number, weight: number): number {
  if (!text) return 0;
  if (ruler === undefined) ruler = document.createElement('canvas').getContext('2d');
  if (!ruler) return text.length * size * 0.6;  // канвы нет — считаем на глаз
  const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
  ruler.font = `${weight} ${size}px ${family}`;
  return ruler.measureText(text).width;
}

/** Размер каждой карточки: высота общая, ширина — под свой текст.
 *
 * Раньше ширина была постоянной, и длинное название обрезалось многоточием
 * даже там, где на схеме места вагон. Теперь карточка растёт под то, что на
 * ней написано, — в разумных пределах.
 */
export function nodeSizes(
  nodes: { id: number; title: string; ports: string; lines: string[] }[],
  look: TopologyAppearance,
): Map<number, NodeSize> {
  const card = nodeMetrics(look);
  const sizes = new Map<number, NodeSize>();
  for (const node of nodes) {
    // Верхняя строка: кружок, название, зазор и счётчик портов у правого края.
    const reserved = 28 + 11 + (node.ports ? 12 + textWidth(node.ports, look.deviceLineSize, 600) : 0);
    const top = reserved + textWidth(node.title, look.deviceTitleSize, look.deviceTitleWeight);
    const rest = node.lines.length
      ? 22 + Math.max(...node.lines.map((t) => textWidth(t, look.deviceLineSize, look.deviceLineWeight)))
      : 0;
    const width = Math.min(Math.max(Math.ceil(Math.max(top, rest)), WIDTH_LIMITS.min), WIDTH_LIMITS.max);
    sizes.set(node.id, {
      width,
      height: card.height,
      // Сколько места осталось названию — то же число, из которого считалась
      // ширина. Раньше запас под счётчик портов стоял в разметке отдельной
      // константой, и на широкой карточке название всё равно обрезалось: два
      // числа про одно и то же неизбежно расходятся.
      titleRoom: Math.max(width - reserved, 20),
    });
  }
  return sizes;
}

export interface NodeSize {
  width: number;
  height: number;
  titleRoom: number;
}

export const STUB_SIZE = 26;
export const GROUP_MIN = { width: 240, height: 140 };
export const NEUTRAL = '#adb5bd';

/** Узел устройства: карточка с цветной рамкой-градиентом по модели техники,
 * кружок цвета модели, название крупно, счётчик портов и код под ним.
 *
 * Крупно именно название: на схему смотрят, чтобы найти «станок №7», а код
 * нужен уже потом — переписать в заявку или найти наклейку на корпусе.
 *
 * Рамка сделана двумя прямоугольниками: нижний залит градиентом, верхний —
 * цветом фона и на полтора пиксела меньше. В SVG это единственный простой
 * способ получить цветной контур с градиентом, как в CSS.
 */
export const DeviceShape = dia.Element.define(
  'netdoc.Device',
  {
    size: NODE,
    attrs: {
      border: { width: 'calc(w)', height: 'calc(h)', rx: 10, ry: 10 },
      body: {
        x: 1.5, y: 1.5, width: 'calc(w-3)', height: 'calc(h-3)', rx: 8.5, ry: 8.5,
        fill: '#ffffff',
      },
      // Кружок цвета модели стоит вровень с названием: его `cy` задаётся у
      // экземпляра вместе с положением названия.
      dot: { cx: 17, r: 4, fill: NEUTRAL },
      // Ширина под обрезку многоточием задаётся у экземпляра: она зависит
      // от того, сколько на этой карточке занял счётчик портов.
      title: { x: 28, fontFamily: 'inherit', textVerticalAnchor: 'middle' },
      ports: {
        x: 'calc(w-11)', textAnchor: 'end', textVerticalAnchor: 'middle',
        fill: '#868e96', fontFamily: 'inherit',
      },
      // Строки под названием: код, адрес управления, модель, фирма. Каждая
      // включается отдельно, выключенная просто пуста и места не занимает —
      // её место считается заранее, в nodeMetrics.
      // Размер, положение и обрезка длинного текста задаются у экземпляра:
      // они зависят от настроек вида и от того, какие строки включены.
      line1: { x: 11, fontFamily: 'inherit', textVerticalAnchor: 'middle' },
      line2: { x: 11, fontFamily: 'inherit', textVerticalAnchor: 'middle' },
      line3: { x: 11, fontFamily: 'inherit', textVerticalAnchor: 'middle' },
      line4: { x: 11, fontFamily: 'inherit', textVerticalAnchor: 'middle' },
    },
  },
  {
    markup: [
      { tagName: 'rect', selector: 'border' },
      { tagName: 'rect', selector: 'body' },
      { tagName: 'circle', selector: 'dot' },
      { tagName: 'text', selector: 'title' },
      { tagName: 'text', selector: 'ports' },
      { tagName: 'text', selector: 'line1' },
      { tagName: 'text', selector: 'line2' },
      { tagName: 'text', selector: 'line3' },
      { tagName: 'text', selector: 'line4' },
    ],
  },
);

/** Сколько строк под названием карточка умеет показать. Разметка фигуры
 * общая на все узлы и списком не повторяется — поэтому мест ровно столько,
 * сколько селекторов заведено выше. */
export const CARD_LINES = 4;

/** Рамка группы: прямоугольник позади узлов с подписью, врезанной в контур. */
export const GroupShape = dia.Element.define(
  'netdoc.Group',
  {
    size: GROUP_MIN,
    attrs: {
      body: {
        width: 'calc(w)', height: 'calc(h)', rx: 12, ry: 12,
        fill: 'transparent', stroke: '#4dabf7', strokeWidth: 1.5,
      },
      // Подложка меряется по самой подписи (`ref` и `calc`), а не по числу
      // букв: ширина буквы у кириллицы и латиницы разная, и подобранный на
      // глаз коэффициент оставлял то пустое поле справа, то обрезанный хвост.
      labelBack: {
        ref: 'label',
        x: 'calc(x-9)', y: 'calc(y-5)', width: 'calc(w+18)', height: 'calc(h+10)',
        rx: 7, ry: 7, fill: '#ffffff',
      },
      label: {
        x: 14, fontSize: 12, fontWeight: 600, fill: '#4dabf7', fontFamily: 'inherit',
        textVerticalAnchor: 'middle',
      },
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

/** Свободный конец кабеля: порт, в который он был воткнут, сняли, а кабель
 * остался проложен. Рисуется кружком под устройством — его тянут на другое
 * устройство, чтобы воткнуть заново. */
export const StubShape = dia.Element.define(
  'netdoc.Stub',
  {
    size: { width: STUB_SIZE, height: STUB_SIZE },
    attrs: {
      body: {
        width: 'calc(w)', height: 'calc(h)', rx: 'calc(w/2)', ry: 'calc(h/2)',
        fill: '#ffffff', stroke: '#f76707', strokeWidth: 2, strokeDasharray: '3 3',
        // Кабель тянут прямо от заглушки, поэтому она сама и есть точка
        // подключения — целиться в маленькую метку сбоку неудобно.
        magnet: true, cursor: 'grab',
      },
      label: {
        x: 'calc(w/2)', y: 'calc(h/2+4)', textAnchor: 'middle', fontSize: 10, fontWeight: 700,
        fill: '#f76707', text: '?', pointerEvents: 'none', fontFamily: 'inherit',
      },
    },
  },
  {
    markup: [
      { tagName: 'rect', selector: 'body' },
      { tagName: 'text', selector: 'label' },
    ],
  },
);

/** Цвет с прозрачностью для SVG.
 *
 * `color-mix()` в атрибутах SVG работает не везде, а цвета моделей приходят
 * шестнадцатеричными — поэтому прозрачность дописывается двумя знаками к
 * самому цвету. Незнакомую запись оставляем как есть: пусть лучше будет
 * плотный цвет, чем ничего.
 */
export function withAlpha(color: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
  const hex = Math.round(Math.min(Math.max(alpha, 0), 1) * 255).toString(16).padStart(2, '0');
  return `${color}${hex}`;
}
