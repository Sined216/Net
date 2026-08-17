import { dia, elementTools, linkTools } from '@joint/core';
import { GROUP_MIN } from './shapes';
import type { canvasColors } from '../appearance';

/** Панели действий на узле и на рамке — то же, что NodeToolbar в React Flow.
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
  group: 'M10 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 20v-2a4 4 0 0 0-3-3.85M16 3.13a4 4 0 0 1 0 7.75M3 20v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3',
  folderPlus: 'M12 19H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v3M16 19h6M19 16v6',
  plug: 'M7 12h10M9.5 8.5V5M14.5 8.5V5M7 12v2a5 5 0 0 0 5 5v3',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  devicePlus: 'M3 6h13v12H3zM16 10h6M19 7v6',
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

/** Ручка изменения размера в правом нижнем углу рамки. */
const ResizeControl = elementTools.Control.extend({
  children: [
    {
      tagName: 'rect',
      selector: 'handle',
      attributes: {
        x: -6, y: -6, width: 12, height: 12, rx: 3, ry: 3,
        fill: '#ffffff', stroke: '#4dabf7', 'stroke-width': 2, cursor: 'nwse-resize',
        // Цвета приходят из панели: ручка красится под тему и цвет группы.
      },
    },
  ],
  getPosition(view: dia.ElementView) {
    const { width, height } = view.model.size();
    return { x: width, y: height };
  },
  setPosition(view: dia.ElementView, coordinates: { x: number; y: number }) {
    view.model.resize(
      Math.max(coordinates.x, GROUP_MIN.width),
      Math.max(coordinates.y, GROUP_MIN.height),
    );
  },
});

export function deviceTools(deviceId: number, actions: {
  edit: Action; copy: Action; regroup: Action; remove: Action;
}, look: ToolsLook): dia.ToolsView {
  const icon = look.paint.icon;
  return new dia.ToolsView({
    name: 'device',
    tools: [
      button(ICONS.pencil, 'Редактировать', icon, 0, look, () => actions.edit(deviceId)),
      button(ICONS.copy, 'Копировать — новое устройство по той же модели', icon, 1, look,
             () => actions.copy(deviceId)),
      button(ICONS.group, 'В группу — или из неё', icon, 2, look, () => actions.regroup(deviceId)),
      button(ICONS.trash, 'Удалить', '#e03131', 3, look, () => actions.remove(deviceId)),
      // Кабель тянут отсюда: своей «точки подключения» у узла нет, и это
      // честнее, чем делать магнитом весь корпус — иначе перетаскивание узла
      // и протягивание кабеля были бы одним жестом.
      new elementTools.Connect({
        x: 0, y: 0, scale: look.zoom,
        offset: { x: (18 + 4 * 30) * look.zoom, y: -20 * look.zoom },
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

export function groupTools(groupId: number, actions: {
  editGroup: Action; addSubgroup: Action; addDeviceToGroup: Action; removeGroup: Action; layoutGroup: Action;
}, color: string, look: ToolsLook): dia.ToolsView {
  const icon = look.paint.icon;
  return new dia.ToolsView({
    name: 'group',
    tools: [
      button(ICONS.pencil, 'Название, цвет и состав группы', icon, 0, look, () => actions.editGroup(groupId)),
      // Общая раскладка про группы не знает, и содержимое рамки сбивается
      // в кучу — особенно после того, как рамку двигали руками.
      button(ICONS.grid, 'Разложить содержимое рядами', icon, 1, look, () => actions.layoutGroup(groupId)),
      button(ICONS.devicePlus, 'Добавить устройство в эту группу', icon, 2, look,
             () => actions.addDeviceToGroup(groupId)),
      button(ICONS.folderPlus, 'Добавить подгруппу', icon, 3, look, () => actions.addSubgroup(groupId)),
      button(ICONS.trash, 'Удалить группу — устройства останутся', '#e03131', 4, look,
             () => actions.removeGroup(groupId)),
      new ResizeControl({ handleAttributes: { fill: look.paint.plate, stroke: color } }),
    ],
  });
}

/** У кабеля свой набор: клик открывает правку, а на самой линии — только
 * подсветка границы, чтобы было видно, что попал именно в неё. */
export function linkHoverTools(): dia.ToolsView {
  return new dia.ToolsView({ name: 'link', tools: [new linkTools.Boundary({ padding: 6 })] });
}
