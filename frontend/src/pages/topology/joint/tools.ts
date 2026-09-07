import { dia, elementTools, linkTools } from '@joint/core';
import type { canvasColors } from '../appearance';

/** Панель действий на узле — то же, что NodeToolbar в React Flow.
 *
 * В JointJS это «инструменты»: набор кнопок, который вешается на вид ячейки
 * и снимается вместе с ней. Кнопки рисуются вручную — своей иконочной темы у
 * библиотеки нет, поэтому берём те же контуры, что и в остальном интерфейсе.
 */

type Action = (id: number) => void;
type Paint = ReturnType<typeof canvasColors>;

/** Как рисовать панель: цвета темы и поправка на масштаб полотна.
 *
 * Поправка нужна потому, что инструменты живут в системе координат схемы:
 * отдалили схему вдвое — и кнопки стали вдвое мельче, попасть в них уже
 * нечем. Здесь они растут обратно, оставаясь одного размера на экране.
 */
export interface ToolsLook {
  paint: Paint;
  /** 1 при обычном масштабе, больше — когда схему отдалили. */
  zoom: number;
}

/** Иконки — контуры из того же набора, что и во всём интерфейсе (Tabler),
 * вписанные в квадрат 24×24 с масштабом 0.7. */
const ICONS: Record<string, string> = {
  pencil: 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3zM13.5 6.5l4 4',
  copy: 'M8 8m0 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2zM16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3',
  plug: 'M7 12h10M9.5 8.5V5M14.5 8.5V5M7 12v2a5 5 0 0 0 5 5v3',
};

function button(icon: string, title: string, color: string, index: number, look: ToolsLook,
                 action: () => void) {
  const k = look.zoom;
  return new elementTools.Button({
    focusOpacity: 0.5,
    // Панель висит над узлом одной строкой. Отступы умножаются на поправку
    // вместе с самой кнопкой — иначе при отдалении кнопки налезали бы друг
    // на друга.
    x: 0, y: 0,
    scale: k,
    offset: { x: (18 + index * 30) * k, y: -20 * k },
    markup: [
      {
        tagName: 'rect',
        selector: 'plate',
        attributes: {
          x: -13, y: -13, width: 26, height: 26, rx: 6, ry: 6,
          fill: look.paint.plate, stroke: look.paint.plateBorder, 'stroke-width': 1, cursor: 'pointer',
        },
      },
      {
        tagName: 'path',
        selector: 'icon',
        attributes: {
          d: icon, transform: 'translate(-8.4,-8.4) scale(0.7)',
          fill: 'none', stroke: color, 'stroke-width': 2,
          'stroke-linecap': 'round', 'stroke-linejoin': 'round',
          cursor: 'pointer', 'pointer-events': 'none',
        },
      },
      { tagName: 'title', selector: 'hint', children: [title] },
    ],
    action,
  });
}

export function deviceTools(deviceId: number, actions: {
  edit: Action; copy: Action; remove: Action;
}, look: ToolsLook): dia.ToolsView {
  const icon = look.paint.icon;
  const entries = [
    { icon: ICONS.pencil, title: 'Редактировать', color: icon, action: () => actions.edit(deviceId) },
    { icon: ICONS.copy, title: 'Копировать — новое устройство по той же модели', color: icon,
      action: () => actions.copy(deviceId) },
    { icon: ICONS.trash, title: 'Удалить', color: '#e03131', action: () => actions.remove(deviceId) },
  ];
  return new dia.ToolsView({
    name: 'device',
    tools: [
      ...entries.map((e, i) => button(e.icon, e.title, e.color, i, look, e.action)),
      // Кабель тянут отсюда: своей «точки подключения» у узла нет, и это
      // честнее, чем делать магнитом весь корпус — иначе перетаскивание узла
      // и протягивание кабеля были бы одним жестом.
      new elementTools.Connect({
        x: 0, y: 0, scale: look.zoom,
        offset: { x: (18 + entries.length * 30) * look.zoom, y: -20 * look.zoom },
        markup: [
          {
            tagName: 'rect',
            attributes: {
              x: -13, y: -13, width: 26, height: 26, rx: 6, ry: 6,
              fill: look.paint.plate, stroke: look.paint.plateBorder, 'stroke-width': 1,
              cursor: 'crosshair',
            },
          },
          {
            tagName: 'path',
            attributes: {
              d: ICONS.plug, transform: 'translate(-8.4,-8.4) scale(0.7)',
              fill: 'none', stroke: '#1971c2', 'stroke-width': 2,
              'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'none',
            },
          },
          { tagName: 'title', children: ['Протянуть кабель — тяните на другое устройство'] },
        ],
      }),
    ],
  });
}

/** У кабеля свой набор: клик открывает правку, а на самой линии — только
 * подсветка границы, чтобы было видно, что попал именно в неё. */
export function linkHoverTools(): dia.ToolsView {
  return new dia.ToolsView({ name: 'link', tools: [new linkTools.Boundary({ padding: 6 })] });
}
