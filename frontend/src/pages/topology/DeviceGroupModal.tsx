import { useState } from 'react';
import { Button, Group, Modal, Select, Stack, Text } from '@mantine/core';
import { useTopologyDevices, useTopologyGroups, useUpdateDevice } from '../../api/hooks';
import { notifyError, notifySuccess } from '../../lib/notify';
import { orderedGroups } from './groups';

/** В какую группу положить устройство.
 *
 * Дублирует перетаскивание в рамку — но перетаскивание требует, чтобы рамка
 * была на экране, а нужная группа может быть далеко за краем или вовсе
 * пустой, без единого устройства и потому без рамки.
 */
export function DeviceGroupModal({ deviceId, onClose }: { deviceId: number; onClose: () => void }) {
  const { data: devices = [] } = useTopologyDevices();
  const { data: groups = [] } = useTopologyGroups();
  const updateDevice = useUpdateDevice();

  const device = devices.find((d) => d.id === deviceId);
  const [groupId, setGroupId] = useState<string | null>(
    device?.topology_group_id != null ? String(device.topology_group_id) : null,
  );

  const options = orderedGroups(groups).map(({ group, depth }) => ({
    value: String(group.id),
    label: `${'— '.repeat(depth)}${group.name}`,
  }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateDevice.mutate(
      { id: deviceId, body: { topology_group_id: groupId ? parseInt(groupId, 10) : null } },
      {
        onSuccess: () => { notifySuccess(groupId ? 'Устройство в группе' : 'Устройство вынесено из группы'); onClose(); },
        onError: notifyError,
      },
    );
  }

  return (
    <Modal opened onClose={onClose} title={`Группа устройства ${device?.code ?? ''}`} size="sm">
      <form onSubmit={handleSubmit}>
        <Stack>
          <Select
            label="Группа" placeholder="— без группы —" clearable searchable
            description="Устройство состоит ровно в одной группе — в самой внутренней"
            data={options} value={groupId} onChange={setGroupId}
          />
          {options.length === 0 && (
            <Text size="xs" c="dimmed">Групп ещё нет — заведите их кнопкой «Группы» над схемой.</Text>
          )}
          <Group justify="flex-end" mt="sm">
            <Button variant="subtle" onClick={onClose}>Отмена</Button>
            <Button type="submit" loading={updateDevice.isPending}>Сохранить</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
