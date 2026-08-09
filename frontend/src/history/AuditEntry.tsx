import { Stack, Text } from '@mantine/core';
import type { AuditEntryOut } from '../api/types';

/** Разница «было — стало» одной записи журнала.
 *
 * Сам разбор делает сервер, здесь только показ: у создания видно, с чем
 * запись завели, у удаления — что пропало, у правки — только изменившиеся
 * поля. Живёт отдельно от страницы, потому что тот же список нужен и в
 * карточке устройства.
 */
export function AuditChanges({ entry, max = 6 }: { entry: AuditEntryOut; max?: number }) {
  if (entry.changes.length === 0) {
    return <Text size="xs" c="dimmed">—</Text>;
  }
  const shown = entry.changes.slice(0, max);
  return (
    <Stack gap={2}>
      {shown.map((change) => (
        <Text key={change.field} size="xs">
          <Text span c="dimmed">{change.label}: </Text>
          {change.old != null && (
            <Text span td={entry.action === 'delete' ? undefined : 'line-through'} c="dimmed">
              {change.old}
            </Text>
          )}
          {change.old != null && change.new != null && <Text span c="dimmed"> → </Text>}
          {change.new != null && <Text span>{change.new}</Text>}
        </Text>
      ))}
      {entry.changes.length > max && (
        <Text size="xs" c="dimmed">и ещё полей: {entry.changes.length - max}</Text>
      )}
    </Stack>
  );
}

export function actionLabel(action: string): string {
  if (action === 'create') return 'заведено';
  if (action === 'update') return 'правка';
  if (action === 'delete') return 'удалено';
  return action;
}

export function actionColor(action: string): string {
  if (action === 'create') return 'teal';
  if (action === 'delete') return 'red';
  return 'blue';
}

/** Дата и время в местном виде: «12.08.2026, 14:35». */
export function formatMoment(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}
