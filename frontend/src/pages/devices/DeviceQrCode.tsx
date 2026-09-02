import { Paper, Skeleton, Stack, Text } from '@mantine/core';
import { useDeviceQr } from '../../api/hooks';

/** QR устройства — код (например, «SW-0042»), не ссылка.
 *
 * Ни в вебе, ни в мобильном приложении сканера пока нет: значение кладётся
 * на будущее опознание, ручное или автоматическое. `code`, а не номер
 * записи — он человекочитаем и переживает перенос между базами, номер
 * записи от конкретной базы не оторвать.
 *
 * SVG приходит с сервера готовым текстом (`apiFetch` возвращает не-JSON
 * тело как строку) — рисуется тем же кодом, что уходит на печать этикетки,
 * так что здесь всегда видно ровно то, что распечатается.
 */
export function DeviceQrCode({ deviceId, code }: { deviceId: number; code: string }) {
  const { data: svg, isLoading, error } = useDeviceQr(deviceId);

  return (
    <Paper withBorder p="xs" w={140}>
      <Stack gap={4} align="center">
        {isLoading && <Skeleton height={110} width={110} />}
        {error && <Text size="xs" c="red" ta="center">Не удалось получить QR</Text>}
        {svg && (
          <div
            style={{ width: 110, height: 110 }}
            // Разметка приходит с собственного сервера (см. GET
            // /devices/{id}/qr) — не пользовательский ввод.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
        <Text size="xs" c="dimmed" ff="monospace">{code}</Text>
      </Stack>
    </Paper>
  );
}
