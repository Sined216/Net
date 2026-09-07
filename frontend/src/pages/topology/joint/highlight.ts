import type { dia } from '@joint/core';
import type { HighlightSet } from '../tree';

/** Подсветка выбранной ветки дерева на схеме: класс на виде ячейки и один
 * класс на полотне — не правка атрибутов модели.
 *
 * У линии смена атрибутов заставляет JointJS пересчитать маршрут (обходчик
 * читает их при каждом изменении) — на тысяче кабелей это заметно. Поэтому
 * подсветка не трогает ни `attrs`, ни `z`, только CSS-класс на корневом
 * `<g>` вида ячейки: `.joint-cell` у JointJS уже стоит на нём сама (см.
 * `dia.CellView`), и `picked`/`dimmed` в паре с ним — обычный CSS-переход
 * прозрачности в `topology.css`. Маршрут кабеля от этого не пересчитывается
 * вовсе: тот же `d`, что и до подсветки.
 */
export function applyHighlight(paper: dia.Paper, picked: HighlightSet | null): void {
  const paperEl = paper.el;
  if (!picked) {
    paperEl.classList.remove('dimmed');
    for (const cell of paper.model.getCells()) {
      cell.findView(paper)?.el.classList.remove('picked');
    }
    return;
  }
  paperEl.classList.add('dimmed');
  for (const cell of paper.model.getCells()) {
    const view = cell.findView(paper);
    if (!view) continue;
    const isPicked = cell.isLink()
      ? picked.links.has(cell.get('linkId'))
      : cell.get('kind') === 'device' && picked.devices.has(cell.get('deviceId'));
    view.el.classList.toggle('picked', isPicked);
  }
}
