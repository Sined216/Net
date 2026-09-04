/** Привязка к сетке — одно место на всю схему.
 *
 * Привязывается **середина** карточки, а не её угол, потому что кабель
 * цепляется к середине: у обоих концов связи стоит `anchor: { name:
 * 'center' }` (см. `joint/buildGraph.ts`), и линия идёт от середины к
 * середине, обрезаясь о границу карточки. Прямой кабель между двумя
 * устройствами получается ровно тогда, когда совпадают их середины.
 *
 * Сначала здесь округлялся угол — тем же краем, каким его округляет само
 * полотно. Рассуждение было про карточки, а не про кабели, и на живой схеме
 * сразу стало видно, чего оно стоит: у карточек шириной 171 и 179,
 * поставленных друг под другом, середины разъезжались на четыре пикселя, и
 * вертикальный кабель шёл с изломом. Цена обратного размена честная: края
 * карточек разной ширины теперь в столбце не совпадают. На схеме связей
 * читают кабели, поэтому середина важнее краёв.
 *
 * Рамки групп — исключение: их ровняют по контуру (`snapBoxOut` и округление
 * размера в `joint/tools.ts`), кабели к ним не цепляются.
 *
 * Само полотно JointJS привязывает только перетаскивание и только по углу,
 * поэтому его привязка выключена (`gridSize: 1`), а перетаскивание
 * округляет свой вид ячейки — см. `snapCornerToCenteredGrid` и
 * `useJointPaper.ts`. Всё остальное — растяжка рамки, обе автоматические
 * раскладки, расчёт рамки по содержимому — идёт мимо полотна и округляет
 * себя здесь.
 *
 * Шаг привязки и шаг рисуемой сетки — намеренно разные величины:
 * выключенная привязка это шаг в пиксель, и рисуй сетку тем же числом,
 * вместо неё получилась бы серая заливка из линий через пиксель. Поэтому у
 * полотна отдельно задаётся `drawGridSize`.
 */

import type { TopologyAppearance } from './appearance';

/** Шаг, при котором привязки фактически нет: округление до целого пикселя
 * ничего не двигает, а полотно другого способа её выключить не даёт. */
export const NO_SNAP = 1;

/** Шаг привязки по настройкам: выключенная привязка — это шаг в пиксель. */
export function snapStep(look: TopologyAppearance): number {
  return look.gridSnap ? look.gridSize : NO_SNAP;
}

/** Ближайший узел сетки. */
export function snapValue(value: number, step: number): number {
  if (step <= NO_SNAP) return value;
  return Math.round(value / step) * step;
}

export function snapPoint<T extends { x: number; y: number }>(point: T, step: number): T {
  if (step <= NO_SNAP) return point;
  return { ...point, x: snapValue(point.x, step), y: snapValue(point.y, step) };
}

/** Рамка округляется наружу, а не к ближайшему узлу: она обводит содержимое,
 * и округление внутрь подрезало бы крайнюю карточку ради ровного края. */
export function snapBoxOut<T extends { x: number; y: number; width: number; height: number }>(
  box: T, step: number,
): T {
  if (step <= NO_SNAP) return box;
  const x = Math.floor(box.x / step) * step;
  const y = Math.floor(box.y / step) * step;
  return {
    ...box,
    x,
    y,
    // Ширина считается от нового угла: сдвинув левый край влево, надо на
    // столько же прибавить ширину, иначе правый край уедет внутрь.
    width: Math.ceil((box.x + box.width - x) / step) * step,
    height: Math.ceil((box.y + box.height - y) / step) * step,
  };
}

/** Угол, при котором на узел сетки попадает середина.
 *
 * Нужен полотну: перетаскивание в JointJS оперирует левым верхним углом
 * ячейки (`ElementView.snapToGrid` получает и возвращает именно его), а
 * ровнять нам надо середину. Хранимая координата — тоже середина, и для
 * неё хватает обычного `snapPoint`. */
export function snapCornerToCenteredGrid(
  x: number, y: number, size: { width: number; height: number }, step: number,
): { x: number; y: number } {
  if (step <= NO_SNAP) return { x, y };
  return {
    x: snapValue(x + size.width / 2, step) - size.width / 2,
    y: snapValue(y + size.height / 2, step) - size.height / 2,
  };
}
