import { useState } from 'react';
import {
  ActionIcon, Badge, Button, Group, Modal, Select, Stack, Switch, Table, Text, TextInput, Title,
} from '@mantine/core';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import {
  useConnectorTypes, useCreateConnectorType, useCreateDeviceType, useCreateModule,
  useDeleteConnectorType, useDeleteDeviceType, useDeleteModule, useDeviceTypes, useModules,
  useUpdateConnectorType, useUpdateDeviceType, useUpdateModule,
} from '../api/hooks';
import { nn } from '../lib/utils';
import { notifyError, notifySuccess } from '../lib/notify';
import { useCan } from '../auth/permissions';
import type { ConnectorMedia, ConnectorTypeOut, DeviceTypeOut, TransceiverModuleOut } from '../api/types';

const MEDIA: { value: ConnectorMedia; label: string }[] = [
  { value: 'copper', label: 'медь' },
  { value: 'fiber', label: 'оптика' },
  { value: 'other', label: 'прочее' },
];

export function mediaLabel(media: ConnectorMedia | undefined): string {
  return MEDIA.find((m) => m.value === media)?.label ?? '—';
}

/** Справочники: типы устройств, разъёмы, модули.
 *
 * Всё в одном месте, а не по страницам, к которым относится: заводятся они
 * редко, а искать «где же тут разъёмы» по трём экранам — дольше, чем
 * заполнить.
 */
export function CatalogPage() {
  return (
    <Stack>
      <Title order={2}>Справочники</Title>
      <DeviceTypes />
      <Connectors />
      <Modules />
    </Stack>
  );
}

// ---------- Типы устройств ----------
function DeviceTypes() {
  const { data: types = [] } = useDeviceTypes();
  const canEdit = useCan('edit');
  const deleteType = useDeleteDeviceType();
  const [editing, setEditing] = useState<DeviceTypeOut | 'new' | null>(null);

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Title order={4}>Типы устройств</Title>
        {canEdit && <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setEditing('new')}>Тип</Button>}
      </Group>
      <Text size="xs" c="dimmed">
        Префикс участвует в коде устройства (SW-0001). Его правка действует только на будущие устройства —
        коды уже заведённых напечатаны на наклейках и не переписываются.
      </Text>
      <Table withTableBorder verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Название</Table.Th>
            <Table.Th w={140}>Префикс кода</Table.Th>
            <Table.Th w={80} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {types.map((t) => (
            <Table.Tr key={t.id}>
              <Table.Td>{t.name}</Table.Td>
              <Table.Td><Text ff="monospace">{t.code_prefix}</Text></Table.Td>
              <Table.Td>
                <Group gap={2} justify="flex-end" wrap="nowrap" display={canEdit ? undefined : 'none'}>
                  <ActionIcon variant="subtle" size="sm" onClick={() => setEditing(t)}>
                    <IconPencil size={15} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle" size="sm" color="red"
                    onClick={() => {
                      if (!confirm(`Удалить тип «${t.name}»?`)) return;
                      deleteType.mutate(t.id, { onSuccess: () => notifySuccess('Тип удалён'), onError: notifyError });
                    }}
                  >
                    <IconTrash size={15} />
                  </ActionIcon>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
          {types.length === 0 && (
            <Table.Tr><Table.Td colSpan={3}><Text c="dimmed">Типов ещё нет</Text></Table.Td></Table.Tr>
          )}
        </Table.Tbody>
      </Table>
      {editing && (
        <DeviceTypeModal deviceType={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </Stack>
  );
}

function DeviceTypeModal({ deviceType, onClose }: { deviceType: DeviceTypeOut | null; onClose: () => void }) {
  const createType = useCreateDeviceType();
  const updateType = useUpdateDeviceType();
  const [name, setName] = useState(deviceType?.name ?? '');
  const [prefix, setPrefix] = useState(deviceType?.code_prefix ?? '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = { name: name.trim(), code_prefix: prefix.trim().toUpperCase() };
    if (!body.name || !body.code_prefix) return;
    const onSuccess = () => { notifySuccess(deviceType ? 'Тип сохранён' : 'Тип создан'); onClose(); };
    if (deviceType) {
      if (body.code_prefix !== deviceType.code_prefix
        && !confirm('Сменить префикс? Коды уже заведённых устройств останутся прежними — новый префикс получат только новые.')) return;
      updateType.mutate({ id: deviceType.id, body }, { onSuccess, onError: notifyError });
    } else {
      createType.mutate(body, { onSuccess, onError: notifyError });
    }
  }

  return (
    <Modal opened onClose={onClose} title={deviceType ? `Тип: ${deviceType.name}` : 'Новый тип устройства'} size="sm">
      <form onSubmit={handleSubmit}>
        <Stack>
          <TextInput label="Название" placeholder="напр. Коммутатор" required
            value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <TextInput label="Префикс кода" placeholder="SW" required maxLength={10}
            description="Из него складывается код устройства: SW-0001"
            value={prefix} onChange={(e) => setPrefix(e.currentTarget.value)} />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>Отмена</Button>
            <Button type="submit" loading={createType.isPending || updateType.isPending}>
              {deviceType ? 'Сохранить' : 'Создать'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

// ---------- Разъёмы ----------
function Connectors() {
  const { data: connectors = [] } = useConnectorTypes();
  const canEdit = useCan('edit');
  const deleteConnector = useDeleteConnectorType();
  const [editing, setEditing] = useState<ConnectorTypeOut | 'new' | null>(null);

  return (
    <Stack gap="xs" mt="lg">
      <Group justify="space-between">
        <Title order={4}>Разъёмы</Title>
        {canEdit && <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setEditing('new')}>Разъём</Button>}
      </Group>
      <Text size="xs" c="dimmed">
        То, что физически торчит из железки. SFP и подобные — не разъём, а клетка: разъём у них появляется
        вместе с модулем, поэтому у таких стоит признак «клетка».
      </Text>
      <Table withTableBorder verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Название</Table.Th>
            <Table.Th w={120}>Среда</Table.Th>
            <Table.Th w={120}>Клетка</Table.Th>
            <Table.Th w={80} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {connectors.map((c) => (
            <Table.Tr key={c.id}>
              <Table.Td><Text fw={600}>{c.name}</Text></Table.Td>
              <Table.Td>{mediaLabel(c.media)}</Table.Td>
              <Table.Td>{c.is_cage && <Badge size="sm" variant="light" color="grape">под модуль</Badge>}</Table.Td>
              <Table.Td>
                <Group gap={2} justify="flex-end" wrap="nowrap" display={canEdit ? undefined : 'none'}>
                  <ActionIcon variant="subtle" size="sm" onClick={() => setEditing(c)}>
                    <IconPencil size={15} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle" size="sm" color="red"
                    onClick={() => {
                      if (!confirm(`Удалить разъём «${c.name}»?`)) return;
                      deleteConnector.mutate(c.id, {
                        onSuccess: () => notifySuccess('Разъём удалён'), onError: notifyError,
                      });
                    }}
                  >
                    <IconTrash size={15} />
                  </ActionIcon>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
          {connectors.length === 0 && (
            <Table.Tr><Table.Td colSpan={4}><Text c="dimmed">Разъёмов ещё нет</Text></Table.Td></Table.Tr>
          )}
        </Table.Tbody>
      </Table>
      {editing && (
        <ConnectorModal connector={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </Stack>
  );
}

function ConnectorModal({ connector, onClose }: { connector: ConnectorTypeOut | null; onClose: () => void }) {
  const createConnector = useCreateConnectorType();
  const updateConnector = useUpdateConnectorType();
  const [name, setName] = useState(connector?.name ?? '');
  const [media, setMedia] = useState<string | null>(connector?.media ?? 'copper');
  const [isCage, setIsCage] = useState(connector?.is_cage ?? false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const body = { name: name.trim(), media: (media ?? 'copper') as ConnectorMedia, is_cage: isCage };
    const onSuccess = () => { notifySuccess(connector ? 'Разъём сохранён' : 'Разъём создан'); onClose(); };
    if (connector) updateConnector.mutate({ id: connector.id, body }, { onSuccess, onError: notifyError });
    else createConnector.mutate(body, { onSuccess, onError: notifyError });
  }

  return (
    <Modal opened onClose={onClose} title={connector ? `Разъём: ${connector.name}` : 'Новый разъём'} size="sm">
      <form onSubmit={handleSubmit}>
        <Stack>
          <TextInput label="Название" placeholder="напр. RJ45" required
            value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <Select label="Среда" data={MEDIA} value={media} onChange={setMedia}
            description="Медный порт, оптический или прочее" />
          <Switch
            label="Клетка под модуль"
            description="Для SFP и подобных: разъём появляется вместе с модулем, который в неё вставят"
            checked={isCage} onChange={(e) => setIsCage(e.currentTarget.checked)}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>Отмена</Button>
            <Button type="submit" loading={createConnector.isPending || updateConnector.isPending}>
              {connector ? 'Сохранить' : 'Создать'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

// ---------- Модули ----------
function Modules() {
  const { data: modules = [] } = useModules();
  const canEdit = useCan('edit');
  const { data: connectors = [] } = useConnectorTypes();
  const deleteModule = useDeleteModule();
  const [editing, setEditing] = useState<TransceiverModuleOut | 'new' | null>(null);

  const connectorName = (id: number | null | undefined) => connectors.find((c) => c.id === id)?.name ?? '—';

  return (
    <Stack gap="xs" mt="lg">
      <Group justify="space-between">
        <Title order={4}>Модули</Title>
        {canEdit && <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setEditing('new')}>Модуль</Button>}
      </Group>
      <Text size="xs" c="dimmed">
        То, что вставляют в клетку: SFP, SFP+ и подобные. Модуль и определяет, какой разъём в итоге торчит из
        порта — оптический LC или медный RJ45.
      </Text>
      <Table withTableBorder verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Название</Table.Th>
            <Table.Th w={140}>В клетку</Table.Th>
            <Table.Th w={140}>Даёт разъём</Table.Th>
            <Table.Th>Заметка</Table.Th>
            <Table.Th w={80} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {modules.map((m) => (
            <Table.Tr key={m.id}>
              <Table.Td><Text fw={600}>{m.name}</Text></Table.Td>
              <Table.Td>{connectorName(m.cage_connector_id)}</Table.Td>
              <Table.Td>{connectorName(m.connector_id)}</Table.Td>
              <Table.Td><Text size="sm" c="dimmed">{m.notes ?? '—'}</Text></Table.Td>
              <Table.Td>
                <Group gap={2} justify="flex-end" wrap="nowrap" display={canEdit ? undefined : 'none'}>
                  <ActionIcon variant="subtle" size="sm" onClick={() => setEditing(m)}>
                    <IconPencil size={15} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle" size="sm" color="red"
                    onClick={() => {
                      if (!confirm(`Удалить модуль «${m.name}»?`)) return;
                      deleteModule.mutate(m.id, {
                        onSuccess: () => notifySuccess('Модуль удалён'), onError: notifyError,
                      });
                    }}
                  >
                    <IconTrash size={15} />
                  </ActionIcon>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
          {modules.length === 0 && (
            <Table.Tr><Table.Td colSpan={5}><Text c="dimmed">Модулей ещё нет</Text></Table.Td></Table.Tr>
          )}
        </Table.Tbody>
      </Table>
      {editing && (
        <ModuleModal module={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </Stack>
  );
}

function ModuleModal({ module, onClose }: { module: TransceiverModuleOut | null; onClose: () => void }) {
  const { data: connectors = [] } = useConnectorTypes();
  const createModule = useCreateModule();
  const updateModule = useUpdateModule();
  const [name, setName] = useState(module?.name ?? '');
  const [cage, setCage] = useState<string | null>(module?.cage_connector_id != null ? String(module.cage_connector_id) : null);
  const [connector, setConnector] = useState<string | null>(module?.connector_id != null ? String(module.connector_id) : null);
  const [notes, setNotes] = useState(module?.notes ?? '');

  const cages = connectors.filter((c) => c.is_cage).map((c) => ({ value: String(c.id), label: c.name }));
  const plain = connectors.filter((c) => !c.is_cage).map((c) => ({ value: String(c.id), label: c.name }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const body = {
      name: name.trim(),
      cage_connector_id: cage ? parseInt(cage, 10) : null,
      connector_id: connector ? parseInt(connector, 10) : null,
      notes: nn(notes),
    };
    const onSuccess = () => { notifySuccess(module ? 'Модуль сохранён' : 'Модуль создан'); onClose(); };
    if (module) updateModule.mutate({ id: module.id, body }, { onSuccess, onError: notifyError });
    else createModule.mutate(body, { onSuccess, onError: notifyError });
  }

  return (
    <Modal opened onClose={onClose} title={module ? `Модуль: ${module.name}` : 'Новый модуль'} size="sm">
      <form onSubmit={handleSubmit}>
        <Stack>
          <TextInput label="Название" placeholder="напр. SFP-10G-LR" required
            value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <Select label="В какую клетку" placeholder="— не указано —" clearable
            data={cages} value={cage} onChange={setCage} />
          <Select label="Даёт разъём" placeholder="— не указано —" clearable
            description="Что торчит наружу, когда модуль вставлен"
            data={plain} value={connector} onChange={setConnector} />
          <TextInput label="Заметка" placeholder="партномер, дальность"
            value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>Отмена</Button>
            <Button type="submit" loading={createModule.isPending || updateModule.isPending}>
              {module ? 'Сохранить' : 'Создать'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
