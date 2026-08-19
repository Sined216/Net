import { ActionIcon, Tooltip, type ActionIconProps } from '@mantine/core';
import { IconPencil, IconTrash } from '@tabler/icons-react';
import type { ElementType, ReactNode } from 'react';

interface RowActionProps extends ActionIconProps {
  /** Что делает кнопка — одновременно доступное имя (aria-label) и текст
   * подсказки при наведении. Обязателен: кнопка без текста и без него читалась
   * бы скринридером просто как «кнопка» — см. находку 4 проверки удобства
   * (docs/UX-REVIEW-2026-08-18.md). Где на строке несколько одинаковых
   * действий подряд (правка в каждой строке таблицы), стоит включать в label
   * само название строки — «Изменить «Офис»», а не голое «Изменить»: иначе
   * список из пятидесяти одинаковых имён невозможно различить на слух. */
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  /** Полиморфизм Mantine — кнопка как ссылка (`component={Link} to="…"`). */
  component?: ElementType;
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
export function RowAction({ label, icon, ...rest }: RowActionProps) {
  return (
    <Tooltip label={label}>
      <ActionIcon aria-label={label} variant="subtle" size="sm" {...rest}>
        {icon}
      </ActionIcon>
    </Tooltip>
  );
}

type ShortcutProps = Omit<RowActionProps, 'icon'> & { size?: number };

/** Правка строки — everywhere один и тот же значок-карандаш (находка 6). */
export function EditAction({ label, size = 15, ...rest }: ShortcutProps) {
  return <RowAction label={label} icon={<IconPencil size={size} />} {...rest} />;
}

/** Удаление строки — везде красный значок-корзина. */
export function DeleteAction({ label, size = 15, color = 'red', ...rest }: ShortcutProps) {
  return <RowAction label={label} icon={<IconTrash size={size} />} color={color} {...rest} />;
}
