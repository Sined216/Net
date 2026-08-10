import { dia } from '@joint/core';

/** Фигуры схемы на JointJS: устройство, рамка группы и заглушка свободного
 * конца кабеля.
 *
 * Вынесены из страницы, потому что определяются один раз на всё приложение:
 * `dia.Element.define` регистрирует тип в пространстве имён, и повторный
 * вызов при каждом рендере плодил бы одинаковые типы.
 */

export const NODE = { width: 186, height: 62 };
export const STUB_SIZE = 26;
export const GROUP_MIN = { width: 240, height: 140 };
export const NEUTRAL = '#adb5bd';

/** Узел устройства: цветная полоса по модели, код, название, счётчик портов. */
export const DeviceShape = dia.Element.define(
  'netdoc.Device',
  {
    size: NODE,
    attrs: {
      body: {
        width: 'calc(w)', height: 'calc(h)', rx: 10, ry: 10,
        fill: '#ffffff', stroke: '#dee2e6', strokeWidth: 1.5,
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
