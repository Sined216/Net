import { useState } from 'react';
import {
  Button, ColorInput, Group, Modal, MultiSelect, SegmentedControl, Select, Stack, Table, Text, TextInput, Title,
} from '@mantine/core';
import { IconFolderPlus, IconPlus, IconServer2 } from '@tabler/icons-react';
import { DeleteAction, EditAction, RowAction } from '../components/RowAction';
import {
  useCreateTopologyGroup, useDeleteTopologyGroup, useDevices, useTopologyGroups, useUpdateDevice,
  useUpdateTopologyGroup,
} from '../api/hooks';
import { notifyError, notifySuccess } from '../lib/notify';
import { confirmAction } from '../lib/confirm';
import { orderedGroups } from '../lib/groups';
import type { TopologyGroupOut } from '../api/types';
import { useCan } from '../auth/permissions';

/** Группы устройств: цех — участок — линия.
 *
 * Отдельный от тегов параметр устройства — ровно одна группа, самая
 * внутренняя. Раньше группу заводили только со схемы связей, кнопкой над
 * полотном, — рамка была там же, и заодно с ней жило и управление
 * составом. Рамки на схеме больше нет (была кластером-рамкой вокруг узлов,
 * снята целиком — README, «Заметки»), а список групп остался и переехал
 * на свою страницу, как теги и VLAN.
 */
export function GroupsPage() {
  const canEdit = useCan('edit');
  const { data: groups = [] } = useTopologyGroups();
  const deleteGroup = useDeleteTopologyGroup();
  const [editing, setEditing] = useState<{ group: TopologyGroupOut | null; parentId: number | null } | null>(null);

  async function handleDelete(group: TopologyGroupOut) {
    if (!(await confirmAction(`Удалить группу «${group.name}»? Устройства останутся, подгруппы поднимутся на уровень выше.`))) return;
    deleteGroup.mutate(group.id, { onSuccess: () => notifySuccess('Группа удалена'), onError: notifyError });
  }

  const rows = orderedGroups(groups);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Группы</Title>
        {canEdit && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ group: null, parentId: null })}>
            Группа
          </Button>
        )}
      </Group>
      <Text c="dimmed" size="sm">
        Отдельный от тегов параметр — ровно одна группа на устройство, самая внутренняя. Группы вкладываются друг в
        друга: цех — участок — линия. На схеме связей группа не рисуется — здесь только список и состав.
      </Text>

      <Table withTableBorder verticalSpacing="xs">
        <Table.Tbody>
          {rows.map(({ group, depth }) => {
            // Сколько устройств в группе, считает сервер: возить ради этой
            // цифры всю спецификацию незачем.
            const count = group.device_count;
            return (
              <Table.Tr key={group.id}>
                <Table.Td>
                  <Group gap={6} wrap="nowrap" style={{ paddingLeft: depth * 22 }}>
                    <span className="tag-badge-dot" style={{ background: group.color ?? '#94a3b8' }} />
                    <Text size="sm">{group.name}</Text>
                    {group.kind === 'cabinet' && (
                      <IconServer2 size={13} color="var(--mantine-color-dimmed)" title="Шкаф" />
                    )}
                    <Text size="xs" c="dimmed">{count} уст.</Text>
                  </Group>
                </Table.Td>
                <Table.Td w={110}>
                  {canEdit && (
                    <Group gap={2} justify="flex-end" wrap="nowrap">
                      <EditAction label={`Изменить группу «${group.name}»`} onClick={() => setEditing({ group, parentId: null })} />
                      {group.kind !== 'cabinet' && (
                        <RowAction
                          label={`Добавить подгруппу в «${group.name}»`} icon={<IconFolderPlus size={15} />}
                          onClick={() => setEditing({ group: null, parentId: group.id })}
                        />
                      )}
                      <DeleteAction label={`Удалить группу «${group.name}»`} onClick={() => handleDelete(group)} />
                    </Group>
                  )}
                </Table.Td>
              </Table.Tr>
            );
          })}
          {rows.length === 0 && (
            <Table.Tr><Table.Td colSpan={2}><Text c="dimmed">Групп ещё нет</Text></Table.Td></Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      {editing && (
        <GroupEditModal group={editing.group} parentId={editing.parentId} onClose={() => setEditing(null)} />
      )}
    </Stack>
  );
}

/** Сколько устройств помещается в список выбора состава.
 *
 * Выпадающий список на тысячу с лишним пунктов всё равно не тот способ,
 * которым набирают группу, — там ищут по названию. Ограничение честное: если
 * устройств больше, об этом сказано прямо в окне.
 */
const MEMBER_LIMIT = 500;

/** Правка группы: название, цвет, место во вложенности и состав устройств.
 *
 * Состав меняется только здесь и в карточке самого устройства: на схеме
 * связей группа не рисуется, перетащить туда узел мышью просто негде.
 */
export function GroupEditModal({
  group, parentId = null, draftName, onClose,
}: {
  /** Правим существующую группу или заводим новую (null). */
  group: TopologyGroupOut | null;
  /** Родитель для новой группы — «добавить подгруппу» из строки списка. */
  parentId?: number | null;
  /** Название для новой группы — например взятое из строки файла импорта. */
  draftName?: string;
  onClose: () => void;
}) {
  const isEdit = !!group;
  const { data: groups = [] } = useTopologyGroups();
  // Состав правится только у существующей группы, поэтому для новой список
  // устройств не запрашивается вовсе. Список лёгкий — без портов.
  const { data: devicePage } = useDevices({ limit: MEMBER_LIMIT, sort: 'code' }, !!group);
  const devices = devicePage?.items ?? [];
  const trimmed = (devicePage?.total ?? 0) > devices.length;
  const createGroup = useCreateTopologyGroup();
  const updateGroup = useUpdateTopologyGroup();
  const updateDevice = useUpdateDevice();

  const [name, setName] = useState(group?.name ?? draftName ?? '');
  const [color, setColor] = useState(group?.color ?? '#94a3b8');
  const [kind, setKind] = useState<'area' | 'cabinet'>(group?.kind ?? 'area');
  const [parent, setParent] = useState<string | null>(
    group ? (group.parent_id != null ? String(group.parent_id) : null) : (parentId != null ? String(parentId) : null),
  );
  // Кто уже в группе, известно только после ответа сервера, а начальное
  // значение useState считается один раз — поэтому «ещё не трогали»
  // хранится отдельно от выбранного.
  const [picked, setPicked] = useState<string[] | null>(null);
  const members = picked ?? devices.filter((d) => d.topology_group_id === group?.id).map((d) => String(d.id));

  // Собственные потомки в родители не годятся — получилось бы кольцо, и
  // сервер такой перенос всё равно отвергнет.
  const descendants = new Set<number>();
  const collect = (id: number) => {
    descendants.add(id);
    groups.filter((g) => g.parent_id === id).forEach((g) => collect(g.id));
  };
  if (group) collect(group.id);

  // Внутрь шкафа группу не кладут — он конец дерева, сервер такое всё равно
  // отклонит, но лучше не предлагать выбор, который заведомо будет отвергнут.
  const parentOptions = orderedGroups(groups)
    .filter(({ group: g }) => !descendants.has(g.id) && g.kind !== 'cabinet')
    .map(({ group: g, depth }) => ({ value: String(g.id), label: `${'— '.repeat(depth)}${g.name}` }));

  // Стать шкафом можно, только если внутри нет подгрупп — иначе они
  // окажутся вложены в конец дерева. Устройства этому не мешают.
  const hasSubgroups = group ? groups.some((g) => g.parent_id === group.id) : false;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const body = {
      name: name.trim(),
      color,
      parent_id: parent ? parseInt(parent, 10) : null,
      kind,
    };

    if (!isEdit) {
      createGroup.mutate(body, {
        onSuccess: () => { notifySuccess('Группа создана'); onClose(); },
        onError: notifyError,
      });
      return;
    }

    // Номер правки — тот, что видели при открытии формы: см. app/versioning.py.
    updateGroup.mutate({ id: group!.id, body: { ...body, version: group!.version } }, {
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
            <ColorInput label="Цвет" value={color} onChange={setColor} format="hex"
              swatches={['#94a3b8', '#4dabf7', '#40c057', '#fab005', '#fa5252', '#be4bdb', '#15aabf']} />
            <Select
              label="Внутри группы" placeholder="— верхний уровень —" clearable
              description="Цех — участок — линия"
              data={parentOptions} value={parent} onChange={setParent}
            />
          </Group>
          <div>
            <Text size="sm" fw={500} mb={4}>Вид</Text>
            <SegmentedControl
              fullWidth value={kind} onChange={(v) => setKind(v as 'area' | 'cabinet')}
              data={[
                { label: 'Группа', value: 'area' },
                // Пока внутри есть подгруппы, шкафом стать нельзя — вложенность
                // в конец дерева не имеет смысла.
                { label: 'Шкаф', value: 'cabinet', disabled: hasSubgroups },
              ]}
            />
            <Text size="xs" c="dimmed" mt={4}>
              {kind === 'cabinet'
                ? 'Шкаф — реальная железка, а не область на плане: внутрь него кладут только устройства, подгруппа не заводится.'
                : hasSubgroups
                  ? 'В группе уже есть подгруппы — шкафом она стать не может, пока их не перенести или не удалить.'
                  : 'Цех, участок, линия — область на плане, внутрь которой кладут и устройства, и подгруппы.'}
            </Text>
          </div>
          {isEdit && trimmed && (
            <Text size="xs" c="orange">
              Показаны первые {MEMBER_LIMIT} устройств по коду — на этой площадке их больше. Остальные переносятся в
              группу из своей карточки.
            </Text>
          )}
          {isEdit && (
            <MultiSelect
              label="Устройства в группе" placeholder="выберите устройства" searchable clearable
              description="Устройство состоит ровно в одной группе — в самой внутренней"
              data={devices.map((d) => ({ value: String(d.id), label: d.name ? `${d.code} — ${d.name}` : d.code }))}
              value={members} onChange={setPicked}
            />
          )}
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
