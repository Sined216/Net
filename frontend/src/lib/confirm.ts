/** Замена браузерному `confirm()`.
 *
 * У нативного диалога два изъяна: он не красится под тему интерфейса и
 * выбивается из общего вида, а если человек в браузере отметит «больше не
 * показывать диалоги на этом сайте» — `confirm()` начнёт молча возвращать
 * `false`, и кнопки удаления станут молча ничего не делать, без единой
 * ошибки на экране. Здесь тот же смысл (модальное «да/нет», ждём ответа),
 * но своей модалкой Mantine и без риска быть заглушенным браузером.
 *
 * Стора нет нигде в проекте, поэтому не тянем библиотеку ради одного
 * диалога — état в модуле плюс подписчики и `useSyncExternalStore`
 * (встроен в React) дают тот же эффект в несколько строк.
 */

export type ConfirmState = {
  opened: boolean;
  message: string;
  confirmLabel: string;
  color: string;
  resolve?: (result: boolean) => void;
};

let state: ConfirmState = { opened: false, message: '', confirmLabel: 'Подтвердить', color: 'red' };
const listeners = new Set<() => void>();

function setState(next: ConfirmState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getConfirmState(): ConfirmState {
  return state;
}

/** Спросить подтверждение — как `confirm()`, но с модалкой Mantine.
 *
 * `await confirmAction('Удалить устройство?')` — резолвится в `true`/`false`
 * по выбору человека. Пока открыта одна модалка, вторая не откроется —
 * что на практике и нужно: два запроса подтверждения разом были бы
 * непонятны сами по себе.
 */
export function confirmAction(
  message: string,
  opts?: { confirmLabel?: string; color?: string },
): Promise<boolean> {
  return new Promise((resolve) => {
    setState({
      opened: true,
      message,
      confirmLabel: opts?.confirmLabel ?? 'Подтвердить',
      color: opts?.color ?? 'red',
      resolve,
    });
  });
}

export function resolveConfirm(result: boolean): void {
  state.resolve?.(result);
  setState({ ...state, opened: false, resolve: undefined });
}
