/** Привязка к сетке — одно место на всю схему.
 *
 * Полотно JointJS привязывает само, но только перетаскивание узла: оно
 * округляет положение по `paper.options.gridSize`. Всё остальное, что
 * двигает и растягивает объекты, — растяжка рамки за угол, автоматическая
 * раскладка, расчёт рамки по содержимому — идёт мимо полотна и округляет
 * себя здесь.
 *
 * Шаг привязки и шаг рисуемой сетки — намеренно разные величины. Выключенная
 * привязка это `gridSize: 1` у полотна, и если бы сетка рисовалась тем же
 * числом, вместо неё получилась бы серая заливка из линий через пиксель;
 * поэтому у полотна отдельно задаётся `drawGridSize`.
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

/** Положение карточки хранится серединой, а привязывается — угол.
 *
 * Ровно так привязывает перетаскивание само полотно (у ячейки JointJS
 * положение — левый верхний угол), и глазом читается тоже край, а не
 * середина: карточки разной ширины с привязанными серединами встают в
 * заметно неровный столбец. */
export function snapCenter(center: { x: number; y: number }, size: { width: number; height: number },
                            step: number): { x: number; y: number } {
  if (step <= NO_SNAP) return center;
  return {
    x: snapValue(center.x - size.width / 2, step) + size.width / 2,
    y: snapValue(center.y - size.height / 2, step) + size.height / 2,
  };
}
