import { useMemo, useState } from 'react';
import { Alert, Button, Group, Modal, Select, Stack, Text } from '@mantine/core';
import { useCreateLink, useDevices, useLinkTemplates } from '../../api/hooks';
import { notifyError, notifySuccess } from '../../lib/notify';
import { nnInt } from '../../lib/utils';
import type { DeviceOut, InterfaceOut } from '../../api/types';

/** Что именно соединять, схема не знает: линия тянется между устройствами, а
 * связь в модели — между конкретными портами. Поэтому после перетаскивания
 * спрашиваем порты на обоих концах. */
export function ConnectPortsModal({
  sourceId, targetId, onClose,
}: {
  sourceId: number;
  targetId: number;
  onClose: () => void;
}) {
  const { data: devices = [] } = useDevices();
  const { data: linkTemplates = [] } = useLinkTemplates();
  const createLink = useCreateLink();

  const source = devices.find((d) => d.id === sourceId);
  const target = devices.find((d) => d.id === targetId);

  const freeSource = useFreePorts(source);
  const freeTarget = useFreePorts(target);

  const [portA, setPortA] = useState<string | null>(freeSource[0]?.value ?? null);
  const [portB, setPortB] = useState<string | null>(freeTarget[0]?.value ?? null);
  const [templateId, setTemplateId] = useState<string | null>(null);

  const nothingFree = freeSource.length === 0 || freeTarget.length === 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!portA || !portB) return;
    createLink.mutate(
      {
        interface_a_id: parseInt(portA, 10),
        interface_b_id: parseInt(portB, 10),
        template_id: nnInt(templateId),
      },
      { onSuccess: () => { notifySuccess('Связь создана'); onClose(); }, onError: notifyError },
    );
  }

  return (
    <Modal opened onClose={onClose} title="Соединить устройства" size="md">
      <form onSubmit={handleSubmit}>
        <Stack>
          {nothingFree ? (
            <Alert color="yellow">
              У {freeSource.length === 0 ? deviceLabel(source) : deviceLabel(target)} нет свободных портов.
              Освободите порт или добавьте новый в карточке устройства.
            </Alert>
          ) : (
            <>
              <Select
                label={deviceLabel(source)}
                description="Порт, от которого тянется кабель"
                data={freeSource} value={portA} onChange={setPortA} searchable required
              />
              <Select
                label={deviceLabel(target)}
                description="Порт на другом конце"
                data={freeTarget} value={portB} onChange={setPortB} searchable required
              />
              <Select
                label="Шаблон связи" placeholder="— без шаблона —"
                description="Задаёт цвет и стиль линии на схеме. Можно назначить позже."
                data={linkTemplates.map((t) => ({ value: String(t.id), label: t.name }))}
                value={templateId} onChange={setTemplateId} clearable
              />
              <Text size="xs" c="dimmed">
                Длину и разъём можно указать потом, на странице «Связи».
              </Text>
            </>
          )}
          <Group justify="flex-end" mt="sm">
            <Button variant="subtle" onClick={onClose}>Отмена</Button>
            <Button type="submit" loading={createLink.isPending} disabled={nothingFree || !portA || !portB}>
              Соединить
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** Порт в выпадающем списке: номер, подпись и то, что реально торчит
 * наружу — у клетки с модулем это разъём модуля. */
export function portLabel(iface: InterfaceOut): string {
  const connector = iface.connector_effective?.name
    ?? (iface.empty_cage ? `${iface.connector?.name ?? 'клетка'} — пусто` : null);
  return connector ? `№${iface.port_number} · ${iface.label} · ${connector}` : `№${iface.port_number} · ${iface.label}`;
}

function deviceLabel(device: DeviceOut | undefined): string {
  if (!device) return 'устройства';
  return device.name ? `${device.code} — ${device.name}` : device.code;
}

/** Занятые порты в список не попадают: связь на порт можно повесить только
 * одну, и предлагать занятый — значит гарантированно получить отказ.
 *
 * Занят и тот порт, у которого второй конец кабеля повис: кабель в нём
 * сидит, просто ведёт в никуда. Раньше проверялось наличие соседа, и такие
 * порты предлагались — выбор заканчивался отказом сервера. */
function useFreePorts(device: DeviceOut | undefined) {
  return useMemo(() => {
    if (!device) return [];
    return device.interfaces
      .filter((i) => !i.link_id)
      .sort((a, b) => a.port_number - b.port_number)
      // Разъём в подписи: выбирать порт под кабель, не зная, RJ45 там или
      // оптика, — значит выбирать наугад.
      .map((i) => ({ value: String(i.id), label: portLabel(i) }));
  }, [device]);
}
