import { ActionIcon, Tooltip } from '@mantine/core';
import { IconPencil, IconTrash } from '@tabler/icons-react';
import type { MouseEventHandler, ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface RowActionProps {
  /** Что делает кнопка — одновременно доступное имя (aria-label) и текст
   * подсказки при наведении. Обязателен: кнопка без текста и без него читалась
   * бы скринридером просто как «кнопка» — см. находку 4 проверки удобства
   * (docs/UX-REVIEW-2026-08-18.md). Где на строке несколько одинаковых
   * действий подряд (правка в каждой строке таблицы), стоит включать в label
   * само название строки — «Изменить «Офис»», а не голое «Изменить»: иначе
   * список из пятидесяти одинаковых имён невозможно различить на слух. */
  label: string;
  icon: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement | HTMLAnchorElement>;
  color?: string;
  disabled?: boolean;
  size?: string | number;
  /** Кнопка как ссылка (`<Link to="…">` вместо `<button onClick>`). Набор
   * закрытый и ровно под то, что использует приложение сейчас: полиморфизм
   * ActionIcon у Mantine принимает произвольный компонент через оверлоады,
   * и широкий `ElementType` в этой позиции их ломает (TS2322 на сборке) —
   * держим тип узким, вместо того чтобы бороться с чужой перегрузкой. */
  component?: typeof Link;
  to?: string;
}

/** Кнопка-иконка на строке списка — правка, удаление и подобное точечное
 * действие.
 *
 * Раньше каждая страница заводила `ActionIcon` заново: где-то с `title`,
 * где-то совсем без имени, для одного и того же действия — то значок
 * `edit`, то `pencil` (находки 4, 6 проверки удобства). Один компонент —
 * один вид, одно доступное имя, одна подсказка.
 */
export function RowAction({
  label, icon, onClick, color, disabled, size = 'sm', component, to,
}: RowActionProps) {
  return (
    <Tooltip label={label}>
      <ActionIcon
        aria-label={label} variant="subtle" size={size} color={color} disabled={disabled}
        onClick={onClick} component={component} to={to ?? ''}
      >
        {icon}
      </ActionIcon>
    </Tooltip>
  );
}

/** Пиксельный размер значка внутри кнопки — не путать с `size` самой
 * `RowAction` (semantic-размер контейнера ActionIcon, у ярлыков ниже не
 * меняется и остаётся «sm»). */
type ShortcutProps = Omit<RowActionProps, 'icon' | 'size'> & { size?: number };

/** Правка строки — везде один и тот же значок-карандаш (находка 6). */
export function EditAction({ label, size = 15, ...rest }: ShortcutProps) {
  return <RowAction label={label} icon={<IconPencil size={size} />} {...rest} />;
}

/** Удаление строки — везде красный значок-корзина. */
export function DeleteAction({ label, size = 15, color = 'red', ...rest }: ShortcutProps) {
  return <RowAction label={label} icon={<IconTrash size={size} />} color={color} {...rest} />;
}
