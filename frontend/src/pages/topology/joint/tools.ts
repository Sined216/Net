import { dia, elementTools, linkTools } from '@joint/core';
import { GROUP_MIN } from './shapes';
import type { canvasColors } from '../appearance';

/** То немногое, что осталось жить прямо на полотне.
 *
 * Раньше здесь были панели кнопок: набор действий рисовался поверх схемы
 * рядом с выделенным узлом и рамкой. Действия переехали в меню по правой
 * кнопке — держать два способа сделать одно и то же значит чинить каждую
 * правку дважды, а панель к тому же занимала место над узлом и перекрывала
 * соседей на плотной схеме.
 *
 * Здесь остались только жесты, которые пунктом меню быть не могут: тянуть
 * угол рамки, чтобы изменить её размер, и подсветка линии под курсором.
 */

type Paint = ReturnType<typeof canvasColors>;

/** Ручка изменения размера в правом нижнем углу рамки. */
const ResizeControl = elementTools.Control.extend({
  children: [
    {
      tagName: 'rect',
      selector: 'handle',
      attributes: {
        x: -6, y: -6, width: 12, height: 12, rx: 3, ry: 3,
        fill: '#ffffff', stroke: '#4dabf7', 'stroke-width': 2, cursor: 'nwse-resize',
        // Цвета приходят снаружи: ручка красится под тему и цвет группы.
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

/** Ручка размера у выделенной рамки — единственное, что рамка показывает
 * поверх схемы. */
export function groupResizeTool(color: string, paint: Paint): dia.ToolsView {
  return new dia.ToolsView({
    name: 'group',
    tools: [new ResizeControl({ handleAttributes: { fill: paint.plate, stroke: color } })],
  });
}

/** У кабеля свой набор: клик открывает правку, а на самой линии — только
 * подсветка границы, чтобы было видно, что попал именно в неё. */
export function linkHoverTools(): dia.ToolsView {
  return new dia.ToolsView({ name: 'link', tools: [new linkTools.Boundary({ padding: 6 })] });
}
