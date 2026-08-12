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
  const lines = [look.deviceSubtitle, look.deviceTemplate, look.deviceManufacturer]
    .filter(Boolean).length;
  const titleY = 12 + look.deviceTitleSize;          // базовая линия названия
  const step = look.deviceLineSize + 5;
  const firstLineY = titleY + look.deviceLineSize + 3;
  const height = lines
    ? firstLineY + (lines - 1) * step + 10
    : titleY + 12;
  return { width: NODE_WIDTH, height, titleY, firstLineY, step, lines };
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
      dot: { cx: 17, cy: 22, r: 4, fill: NEUTRAL },
      title: {
        x: 28, fontFamily: 'inherit',
        // Длинное название обрезается многоточием по месту, а не по числу
        // букв: ширину меряет браузер, и «Коммутатор цеха 1» не наезжает на
        // счётчик портов справа.
        textWrap: { width: -74, maxLineCount: 1, ellipsis: true },
      },
      ports: { x: 'calc(w-11)', textAnchor: 'end', fill: '#868e96', fontFamily: 'inherit' },
      // Три строки под названием: код, модель, фирма. Каждая включается
      // отдельно, выключенная просто пуста и места не занимает — её место
      // считается заранее, в nodeMetrics.
      // Размер, положение и обрезка длинного текста задаются у экземпляра:
      // они зависят от настроек вида и от того, какие строки включены.
      line1: { x: 11, fontFamily: 'inherit' },
      line2: { x: 11, fontFamily: 'inherit' },
      line3: { x: 11, fontFamily: 'inherit' },
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
    ],
  },
);

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
      labelBack: { x: 8, y: -9, height: 18, rx: 6, ry: 6, fill: '#ffffff' },
      label: { x: 14, y: 4, fontSize: 12, fontWeight: 600, fill: '#4dabf7', fontFamily: 'inherit' },
      // Размер подписи задаётся у экземпляра — он в настройках вида.
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
