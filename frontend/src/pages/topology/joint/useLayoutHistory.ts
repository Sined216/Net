import { useCallback, useRef, useState } from 'react';
import type { Box, Point } from './buildGraph';

/** Отмена и возврат раскладки схемы.
 *
 * Отменяется только расположение: куда уехали узлы и рамки групп. Это то,
 * что человек портит чаще всего и всегда случайно — потянул не за то, задел
 * пачку, нажал «Разложить» и потерял раскладку, которую собирал полчаса.
 *
 * Заведение и удаление сюда намеренно не попали. «Отменить удаление» — это
 * не движение назад по экрану, а восстановление железки с её кодом,
 * портами и кабелями; делать вид, что Ctrl+Z это умеет, хуже, чем не иметь
 * его вовсе: человек понадеется и потеряет данные. Поэтому удаление
 * по-прежнему спрашивает подтверждение, а Ctrl+Z его не трогает.
 *
 * Шаг хранит «было» и «стало» целиком, а не разницу: применить его в любую
 * сторону — значит просто выставить координаты. Отменённое положение на
 * сервер само по себе не уходит — оно, как и любое другое перетаскивание,
 * ждёт кнопки «Сохранить» (см. `pendingDevices`/`pendingBoxes` в
 * `TopologyPage`).
 */

export interface LayoutStep {
  /** Что делали — показывается человеку в подсказке к кнопке. */
  title: string;
  devices?: { id: number; from: Point; to: Point }[];
  /** Рамки, у которых до шага уже было своё положение. Впервые посчитанную
   * рамку отменять нечем: до неё у группы не было никакой. */
  groups?: { id: number; from: Box; to: Box }[];
}

export interface LayoutHistory {
  /** Запомнить шаг. Пустой (ничего не сдвинулось) не запоминается. */
  push: (step: LayoutStep) => void;
  undo: () => void;
  redo: () => void;
  /** Стереть историю без применения — после отмены несохранённой раскладки
   * целиком: шаги ссылаются на состояние, которого уже нет, и Ctrl+Z по ним
   * вернул бы что-то среднее между старым и новым. */
  clear: () => void;
  canUndo: string | null;
  canRedo: string | null;
}

/** Глубина истории. Двадцати шагов хватает, чтобы вернуться к тому, что
 * было «пару движений назад», а больше никто и не помнит. */
const DEPTH = 20;

export function useLayoutHistory(apply: (step: LayoutStep, back: boolean) => void): LayoutHistory {
  const done = useRef<LayoutStep[]>([]);
  const undone = useRef<LayoutStep[]>([]);
  // Состояние — только ради подписей на кнопках: сами стопки живут в
  // ссылках, потому что их читают обработчики полотна.
  const [labels, setLabels] = useState<{ undo: string | null; redo: string | null }>({
    undo: null, redo: null,
  });

  const refresh = useCallback(() => {
    setLabels({
      undo: done.current.at(-1)?.title ?? null,
      redo: undone.current.at(-1)?.title ?? null,
    });
  }, []);

  const push = useCallback((step: LayoutStep) => {
    const devices = (step.devices ?? []).filter((m) => m.from.x !== m.to.x || m.from.y !== m.to.y);
    const groups = (step.groups ?? []).filter((g) => !sameBox(g.from, g.to));
    if (!devices.length && !groups.length) return;
    done.current = [...done.current, { ...step, devices, groups }].slice(-DEPTH);
    // Новое действие обрывает ветку возврата: вернуть то, поверх чего уже
    // сделали другое, значит получить смесь двух раскладок.
    undone.current = [];
    refresh();
  }, [refresh]);

  const undo = useCallback(() => {
    const step = done.current.at(-1);
    if (!step) return;
    done.current = done.current.slice(0, -1);
    undone.current = [...undone.current, step];
    apply(step, true);
    refresh();
  }, [apply, refresh]);

  const redo = useCallback(() => {
    const step = undone.current.at(-1);
    if (!step) return;
    undone.current = undone.current.slice(0, -1);
    done.current = [...done.current, step];
    apply(step, false);
    refresh();
  }, [apply, refresh]);

  const clear = useCallback(() => {
    done.current = [];
    undone.current = [];
    refresh();
  }, [refresh]);

  return { push, undo, redo, clear, canUndo: labels.undo, canRedo: labels.redo };
}

function sameBox(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
