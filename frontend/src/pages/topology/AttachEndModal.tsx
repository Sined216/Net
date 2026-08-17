import { useMemo, useState } from 'react';
import { Alert, Button, Group, Modal, Select, Stack, Text } from '@mantine/core';
import { useAttachLinkEnd, useDevice, useDeviceTemplates } from '../../api/hooks';
import { notifyError, notifySuccess } from '../../lib/notify';
import { deviceLabel } from '../../lib/utils';
import { portLabel } from './ConnectPortsModal';

/** Куда воткнуть повисший конец кабеля.
 *
 * Заглушку свободного конца перетащили на устройство — осталось выбрать
 * гнездо. Кабель при этом остаётся тем же: длина, разъём и заметки при нём,
 * меняется только конец. Заводить связь заново было бы неправильно — это
 * другой кабель.
 */
export function AttachEndModal({
  linkId, deviceId, onClose,
}: {
  linkId: number;
  deviceId: number;
  onClose: () => void;
}) {
  // Нужна одна железка — та, на которую бросили конец кабеля. Раньше ради
  // неё приезжали все устройства площадки со всеми портами.
  const { data: device } = useDevice(deviceId);
  const { data: templates = [] } = useDeviceTemplates();
  const attach = useAttachLinkEnd();

  // Порт занят, даже если на том конце кабеля никого нет: воткнуть в него
  // второй кабель нельзя, и предлагать его бессмысленно.
  const free = useMemo(
    () => (device?.interfaces ?? [])
      .filter((i) => !i.link_id)
      .sort((a, b) => a.port_number - b.port_number)
      .map((i) => ({ value: String(i.id), label: portLabel(i) })),
    [device],
  );

  // Порт выбирается сам, но только когда список приехал: до этого выбирать
  // не из чего, а начальное значение useState считается один раз.
  const [port, setPort] = useState<string | null>(null);
  const chosen = port ?? free[0]?.value ?? null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    attach.mutate(
      { id: linkId, interfaceId: parseInt(chosen, 10) },
      { onSuccess: () => { notifySuccess('Кабель подключён'); onClose(); }, onError: notifyError },
    );
  }

  const label = device
    ? deviceLabel(device.code, device.name, templates.find((t) => t.id === device.template_id)?.name)
    : 'устройство';

  return (
    <Modal opened onClose={onClose} title="Подключить свободный конец" size="md">
      <form onSubmit={handleSubmit}>
        <Stack>
          {free.length === 0 ? (
            <Alert color="yellow">
              У {label} нет свободных портов. Освободите порт или добавьте новый — состав портов задаётся
              в шаблоне модели.
            </Alert>
          ) : (
            <>
              <Select
                label={label} description="Гнездо, в которое втыкается конец кабеля"
                data={free} value={chosen} onChange={setPort} searchable required
              />
              <Text size="xs" c="dimmed">
                Сам кабель остаётся прежним — длина, разъём и заметки при нём.
              </Text>
            </>
          )}
          <Group justify="flex-end" mt="sm">
            <Button variant="subtle" onClick={onClose}>Отмена</Button>
            <Button type="submit" loading={attach.isPending} disabled={!chosen}>Подключить</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
