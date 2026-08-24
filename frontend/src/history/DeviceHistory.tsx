import { Anchor, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useAudit } from '../api/hooks';
import { AuditChanges, actionLabel, formatMoment } from './AuditEntry';

const SHOWN = 5;

/** Последние изменения этого устройства — прямо в карточке.
 *
 * Вопрос «кто и когда это поменял» возникает, когда смотришь на саму
 * железку, а не когда открываешь общий журнал: ради него незачем уходить со
 * страницы и искать нужную строку среди чужих.
 */
export function DeviceHistory({ deviceId }: { deviceId: number }) {
  const { data } = useAudit({ entity_type: 'device', entity_id: deviceId, limit: SHOWN });
  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <Paper withBorder p="sm">
      <Group justify="space-between" mb="xs">
        <Title order={5}>Последние изменения</Title>
        <Anchor component={Link} to="/history" size="sm">Вся история</Anchor>
      </Group>
      <Stack gap={6}>
        {items.map((entry) => (
          <Group key={entry.id} gap="xs" align="flex-start" wrap="nowrap">
            <Text size="xs" c="dimmed" w={110} style={{ flexShrink: 0 }}>
              {formatMoment(entry.created_at)}
            </Text>
            <Text size="xs" w={80} style={{ flexShrink: 0 }}>{actionLabel(entry.action)}</Text>
            <Text size="xs" w={140} style={{ flexShrink: 0 }} truncate>{entry.user_name ?? '—'}</Text>
            <AuditChanges entry={entry} max={3} />
          </Group>
        ))}
      </Stack>
    </Paper>
  );
}
