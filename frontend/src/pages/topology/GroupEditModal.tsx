import { useState } from 'react';
import { Button, ColorInput, Group, Modal, MultiSelect, Select, Stack, Text, TextInput } from '@mantine/core';
import {
  useCreateTopologyGroup, useTopologyDevices, useTopologyGroups, useUpdateDevice, useUpdateTopologyGroup,
} from '../../api/hooks';
import { notifyError, notifySuccess } from '../../lib/notify';
import { orderedGroups } from './groups';
import type { TopologyGroupOut } from '../../api/types';

/** Правка группы: название, цвет, место во вложенности и состав устройств.
 *
 * Состав меняется только здесь и в панели самого устройства — перетаскивание
 * узла в рамку его не меняет: жест «подвинуть узел» и жест «сменить группу»
 * не должны быть одним и тем же, иначе схему нельзя разложить, не задев
 * данные.
 */
export function GroupEditModal({
  group, parentId = null, draftName, onClose,
}: {
  /** Правим существующую группу или заводим новую (null). */
  group: TopologyGroupOut | null;
  /** Родитель для новой группы — «добавить подгруппу» из панели. */
  parentId?: number | null;
  /** Название для новой группы — например взятое из строки файла импорта. */
  draftName?: string;
  onClose: () => void;
}) {
  const isEdit = !!group;
  const { data: groups = [] } = useTopologyGroups();
  const { data: devices = [] } = useTopologyDevices();
  const createGroup = useCreateTopologyGroup();
  const updateGroup = useUpdateTopologyGroup();
  const updateDevice = useUpdateDevice();

  const [name, setName] = useState(group?.name ?? draftName ?? '');
  const [color, setColor] = useState(group?.color ?? '#94a3b8');
  const [parent, setParent] = useState<string | null>(
    group ? (group.parent_id != null ? String(group.parent_id) : null) : (parentId != null ? String(parentId) : null),
  );
  const [members, setMembers] = useState<string[]>(
    devices.filter((d) => d.topology_group_id === group?.id).map((d) => String(d.id)),
  );

  // Собственные потомки в родители не годятся — получилось бы кольцо, и
  // сервер такой перенос всё равно отвергнет.
  const descendants = new Set<number>();
  const collect = (id: number) => {
    descendants.add(id);
    groups.filter((g) => g.parent_id === id).forEach((g) => collect(g.id));
  };
  if (group) collect(group.id);

  const parentOptions = orderedGroups(groups)
    .filter(({ group: g }) => !descendants.has(g.id))
    .map(({ group: g, depth }) => ({ value: String(g.id), label: `${'— '.repeat(depth)}${g.name}` }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const body = {
      name: name.trim(),
      color,
      parent_id: parent ? parseInt(parent, 10) : null,
    };

    if (!isEdit) {
      createGroup.mutate(body, {
        onSuccess: () => { notifySuccess('Группа создана'); onClose(); },
        onError: notifyError,
      });
      return;
    }

    updateGroup.mutate({ id: group!.id, body }, {
      onSuccess: () => {
        // Состав применяется отдельными правками устройств: группа у
        // устройства — его собственное поле, а не список внутри группы.
        const chosen = new Set(members.map((id) => parseInt(id, 10)));
        for (const device of devices) {
          const wasIn = device.topology_group_id === group!.id;
          const isIn = chosen.has(device.id);
          if (wasIn === isIn) continue;
          updateDevice.mutate({ id: device.id, body: { topology_group_id: isIn ? group!.id : null } });
        }
        notifySuccess('Группа сохранена');
        onClose();
      },
      onError: notifyError,
    });
  }

  return (
    <Modal opened onClose={onClose} title={isEdit ? `Группа: ${group!.name}` : 'Новая группа'} size="md">
      <form onSubmit={handleSubmit}>
        <Stack>
          <TextInput
            label="Название" placeholder="напр. Цех 1" required
            value={name} onChange={(e) => setName(e.currentTarget.value)}
          />
          <Group grow>
            <ColorInput label="Цвет рамки" value={color} onChange={setColor} format="hex"
              swatches={['#94a3b8', '#4dabf7', '#40c057', '#fab005', '#fa5252', '#be4bdb', '#15aabf']} />
            <Select
              label="Внутри группы" placeholder="— верхний уровень —" clearable
              description="Цех — участок — линия"
              data={parentOptions} value={parent} onChange={setParent}
            />
          </Group>
          {isEdit && (
            <MultiSelect
              label="Устройства в группе" placeholder="выберите устройства" searchable clearable
              description="Устройство состоит ровно в одной группе — в самой внутренней"
              data={devices.map((d) => ({ value: String(d.id), label: d.name ? `${d.code} — ${d.name}` : d.code }))}
              value={members} onChange={setMembers}
            />
          )}
          <Text size="xs" c="dimmed">
            Рамку на схеме двигают и растягивают мышью — состав группы от этого не меняется.
          </Text>
          <Group justify="flex-end" mt="sm">
            <Button variant="subtle" onClick={onClose}>Отмена</Button>
            <Button type="submit" loading={createGroup.isPending || updateGroup.isPending}>
              {isEdit ? 'Сохранить' : 'Создать'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
