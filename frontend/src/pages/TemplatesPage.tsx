import { useRef, useState } from 'react';
import {
  ActionIcon, Badge, Button, Group, Modal, NumberInput, Select, Stack,
  Table, Text, TextInput, Textarea, Title, Card, Collapse, ColorInput, Switch, Alert, UnstyledButton,
} from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconEdit, IconPlus, IconTrash } from '@tabler/icons-react';
import {
  useAddTemplateInterface, useCreateDeviceTemplate, useTemplateImpact, useCreateDeviceType, useDeleteDeviceTemplate,
  useDeleteDeviceType, useDeleteTemplateInterface, useDeviceTemplates, useDeviceTypes, useUpdateDeviceTemplate,
} from '../api/hooks';
import { nn } from '../lib/utils';
import { notifyError, notifySuccess } from '../lib/notify';
import type { DeviceTemplateOut, InterfaceTemplateOut, PortType } from '../api/types';

export function TemplatesPage() {
  const { data: types = [] } = useDeviceTypes();
  const { data: templates = [], isLoading } = useDeviceTemplates();
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<DeviceTemplateOut | 'new' | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const deleteType = useDeleteDeviceType();
  const deleteTemplate = useDeleteDeviceTemplate();

  function typeName(id: number) {
    return types.find((t) => t.id === id)?.name ?? '—';
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Типы устройств</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setTypeModalOpen(true)}>
          Тип
        </Button>
      </Group>
      <Table withTableBorder verticalSpacing="xs" mb="md">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Название</Table.Th>
            <Table.Th>Префикс кода</Table.Th>
            <Table.Th w={60} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {types.map((t) => (
            <Table.Tr key={t.id}>
              <Table.Td>{t.name}</Table.Td>
              <Table.Td>{t.code_prefix}</Table.Td>
              <Table.Td>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => {
                    if (!confirm('Удалить тип устройства?')) return;
                    deleteType.mutate(t.id, { onSuccess: () => notifySuccess('Тип удалён'), onError: notifyError });
                  }}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Group justify="space-between">
        <Title order={2}>Шаблоны устройств</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setEditingTemplate('new')}>
          Шаблон
        </Button>
      </Group>
      <Text c="dimmed" size="sm">
        Шаблон описывает модель техники: тип и набор портов. При добавлении устройства в спецификацию оборудования его
        порты копируются из шаблона.
      </Text>

      <Stack gap="xs">
        {templates.map((tpl) => (
          <Card key={tpl.id} withBorder padding="sm">
            <Group justify="space-between">
              <UnstyledButton onClick={() => setExpanded(expanded === tpl.id ? null : tpl.id)} style={{ flex: 1 }}>
                <Group gap="xs">
                  {expanded === tpl.id ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                  <Text fw={600}>{tpl.name}</Text>
                  {tpl.color && <span className="tag-badge-dot" style={{ background: tpl.color }} />}
                  {tpl.manufacturer && <Text c="dimmed">{tpl.manufacturer}</Text>}
                  <Badge variant="light">{typeName(tpl.device_type_id)}</Badge>
                  <Badge variant="light" color="gray">{tpl.interfaces.length} порт(ов)</Badge>
                </Group>
              </UnstyledButton>
              <Group gap={4}>
                <ActionIcon variant="subtle" onClick={() => setEditingTemplate(tpl)}>
                  <IconEdit size={16} />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => {
                    if (!confirm(`Удалить шаблон "${tpl.name}"?`)) return;
                    deleteTemplate.mutate(tpl.id, { onSuccess: () => notifySuccess('Шаблон удалён'), onError: notifyError });
                  }}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            </Group>
            <Collapse expanded={expanded === tpl.id}>
              <Stack mt="sm" gap={4}>
                {tpl.notes && <Text size="sm" c="dimmed">{tpl.notes}</Text>}
                <Table withTableBorder verticalSpacing={4}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={60}>№</Table.Th>
                      <Table.Th>Название</Table.Th>
                      <Table.Th>Тип</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {tpl.interfaces.map((i) => (
                      <Table.Tr key={i.id}>
                        <Table.Td fw={600}>{i.port_number}</Table.Td>
                        <Table.Td>{i.label}</Table.Td>
                        <Table.Td>{i.port_type ?? '—'}</Table.Td>
                      </Table.Tr>
                    ))}
                    {tpl.interfaces.length === 0 && (
                      <Table.Tr>
                        <Table.Td colSpan={3}>
                          <Text c="dimmed" size="sm">Портов ещё нет</Text>
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Table.Tbody>
                </Table>
              </Stack>
            </Collapse>
          </Card>
        ))}
        {!isLoading && templates.length === 0 && <Text c="dimmed">Шаблонов ещё нет — начните с добавления хотя бы одного.</Text>}
      </Stack>

      {typeModalOpen && <DeviceTypeFormModal onClose={() => setTypeModalOpen(false)} />}
      {editingTemplate && (
        <TemplateFormModal template={editingTemplate === 'new' ? null : editingTemplate} onClose={() => setEditingTemplate(null)} />
      )}
    </Stack>
  );
}

function DeviceTypeFormModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [prefix, setPrefix] = useState('');
  const createType = useCreateDeviceType();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createType.mutate(
      { name: name.trim(), code_prefix: prefix.trim().toUpperCase() },
      { onSuccess: () => { notifySuccess('Тип устройства создан'); onClose(); }, onError: notifyError },
    );
  }

  return (
    <Modal opened onClose={onClose} title="Новый тип устройства">
      <form onSubmit={handleSubmit}>
        <Stack>
          <TextInput label="Название" placeholder="напр. Медиаконвертер" value={name} onChange={(e) => setName(e.currentTarget.value)} required />
          <TextInput label="Префикс кода" placeholder="напр. MC" maxLength={8} value={prefix} onChange={(e) => setPrefix(e.currentTarget.value)} required />
          <Text size="xs" c="dimmed">Префикс используется для автогенерации кода устройства: MC-0001, MC-0002...</Text>
          <Group justify="flex-end" mt="sm">
            <Button type="submit" loading={createType.isPending}>Создать</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

interface DraftPort {
  _key: number;
  /** Номер — место порта в ряду гнёзд; его раздаёт сервер, а в черновике
   * он равен позиции в списке. */
  port_number: number;
  label: string;
  port_type: PortType | null;
}

/** Форма шаблона — создание и редактирование в одном месте. В режиме
 * создания порты копятся в черновике и уходят одним запросом при сабмите;
 * в режиме редактирования каждое изменение порта сразу летит на бэкенд. */
function TemplateFormModal({ template, onClose }: { template: DeviceTemplateOut | null; onClose: () => void }) {
  const isEdit = !!template;
  const { data: types = [] } = useDeviceTypes();
  const { data: templates = [] } = useDeviceTemplates();
  const [name, setName] = useState(template?.name ?? '');
  const [typeId, setTypeId] = useState<string | null>(template ? String(template.device_type_id) : null);
  const [manufacturer, setManufacturer] = useState(template?.manufacturer ?? '');
  const [notes, setNotes] = useState(template?.notes ?? '');
  const [color, setColor] = useState(template?.color ?? '');
  const [portsEditable, setPortsEditable] = useState(template?.ports_editable_on_device ?? false);
  // Правка портов задевает все устройства модели — предупреждаем до нажатия.
  const { data: impact } = useTemplateImpact(template?.id ?? null);
  const [draftPorts, setDraftPorts] = useState<DraftPort[]>([]);
  const draftSeq = useRef(0);
  const [portLabel, setPortLabel] = useState('');
  const [portType, setPortType] = useState<string | null>(null);
  const [genCount, setGenCount] = useState<number | ''>(24);

  const createTemplate = useCreateDeviceTemplate();
  const updateTemplate = useUpdateDeviceTemplate();
  const addPort = useAddTemplateInterface();
  const removePort = useDeleteTemplateInterface();

  // Порты берём из свежих данных, а не из пропса: пропс — это снимок,
  // сделанный при открытии модалки, и добавленный порт в нём не появлялся —
  // он был виден только после закрытия, в списке шаблонов.
  const live = isEdit ? templates.find((t) => t.id === template!.id) : undefined;
  const livePorts: InterfaceTemplateOut[] = live?.interfaces ?? template?.interfaces ?? [];
  const currentPorts = isEdit ? livePorts : draftPorts;
  // Номера идут подряд, без пропусков: новый порт всегда встаёт в конец
  // ряда, поэтому его номер — это просто количество портов плюс один.
  const nextPortNumber = currentPorts.length + 1;

  function addPortNow() {
    const number = nextPortNumber;
    const label = portLabel.trim() || `Порт ${number}`;
    const pt = (portType || null) as PortType | null;
    if (isEdit) {
      addPort.mutate({ templateId: template!.id, body: { label, port_type: pt } }, { onError: notifyError });
    } else {
      draftSeq.current += 1;
      setDraftPorts((prev) => [...prev, { _key: draftSeq.current, port_number: number, label, port_type: pt }]);
    }
    setPortLabel('');
  }

  function generatePorts() {
    const n = typeof genCount === 'number' ? genCount : 0;
    if (n <= 0) return;
    const start = currentPorts.length;
    if (isEdit) {
      for (let i = 1; i <= n; i++) {
        addPort.mutate({ templateId: template!.id, body: { label: `Порт ${start + i}` } });
      }
    } else {
      const newPorts: DraftPort[] = [];
      for (let i = 1; i <= n; i++) {
        draftSeq.current += 1;
        newPorts.push({ _key: draftSeq.current, port_number: start + i, label: `Порт ${start + i}`, port_type: null });
      }
      setDraftPorts((prev) => [...prev, ...newPorts]);
    }
  }

  function removePortNow(key: number) {
    if (isEdit) {
      if (!confirm('Убрать порт из модели? Он исчезнет у всех устройств этой модели; кабели, воткнутые в него, останутся с подвешенным концом.')) return;
      removePort.mutate({ templateId: template!.id, ifaceId: key }, { onError: notifyError });
    } else {
      // Ряд гнёзд сплошной — после удаления из середины номера сдвигаются.
      setDraftPorts((prev) => prev
        .filter((p) => p._key !== key)
        .map((p, index) => ({ ...p, port_number: index + 1 })));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!typeId) return;
    const body = {
      name: name.trim(), device_type_id: parseInt(typeId, 10),
      manufacturer: nn(manufacturer), notes: nn(notes), color: nn(color),
      ports_editable_on_device: portsEditable,
    };
    const onSuccess = () => { notifySuccess(isEdit ? 'Шаблон обновлён' : 'Шаблон создан'); onClose(); };
    if (isEdit) {
      updateTemplate.mutate({ id: template!.id, body }, { onSuccess, onError: notifyError });
    } else {
      createTemplate.mutate(
        { ...body, interfaces: draftPorts.map(({ label, port_type }) => ({ label, port_type })) },
        { onSuccess, onError: notifyError },
      );
    }
  }

  const pending = createTemplate.isPending || updateTemplate.isPending;

  return (
    <Modal opened onClose={onClose} title={isEdit ? `Шаблон: ${template!.name}` : 'Новый шаблон устройства'} size="lg">
      <form onSubmit={handleSubmit}>
        <Stack>
          <Group grow>
            <TextInput label="Название" placeholder="напр. Cisco Catalyst 2960-24TT" value={name} onChange={(e) => setName(e.currentTarget.value)} required />
            <Select label="Тип устройства" data={types.map((t) => ({ value: String(t.id), label: t.name }))} value={typeId} onChange={setTypeId} required />
          </Group>
          <TextInput label="Производитель" value={manufacturer} onChange={(e) => setManufacturer(e.currentTarget.value)} />
          <ColorInput
            label="Цвет на схеме"
            description="Красит все устройства этой модели. Пусто — нейтральный узел."
            placeholder="— без цвета —"
            value={color}
            onChange={setColor}
            format="hex"
            swatches={['#4dabf7', '#40c057', '#fab005', '#fa5252', '#be4bdb', '#15aabf', '#868e96']}
          />
          <Switch
            label="Состав портов меняется на устройстве"
            description="Для техники, у которой порты добавляют и снимают по факту — например ПК со съёмной сетевой картой. У остальных моделей порты правятся только здесь, в шаблоне."
            checked={portsEditable}
            onChange={(e) => setPortsEditable(e.currentTarget.checked)}
          />
          <Textarea label="Заметки" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} rows={2} />

          <Text size="sm" c="dimmed">
            Порты шаблона{isEdit ? ' — изменения сохраняются сразу' : ''}:
          </Text>
          {isEdit && impact != null && impact.devices > 0 && (
            <Alert color={impact.connected_ports > 0 ? 'orange' : 'blue'} variant="light">
              По этой модели заведено устройств: {impact.devices}. Добавленный порт появится у всех,
              убранный — исчезнет у всех.
              {impact.connected_ports > 0 && (
                <> Подключённых кабелей у них: {impact.connected_ports} — если убрать порт, у кабеля
                повиснет конец, но сам он останется задокументированным.</>
              )}
            </Alert>
          )}
          <Table withTableBorder verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={60}>№</Table.Th>
                <Table.Th>Название</Table.Th>
                <Table.Th>Тип</Table.Th>
                <Table.Th w={40} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {[...currentPorts].sort((a, b) => a.port_number - b.port_number).map((p) => (
                <Table.Tr key={isEdit ? (p as InterfaceTemplateOut).id : (p as DraftPort)._key}>
                  <Table.Td fw={600}>{p.port_number}</Table.Td>
                  <Table.Td>{p.label}</Table.Td>
                  <Table.Td>{p.port_type ?? '—'}</Table.Td>
                  <Table.Td>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      size="sm"
                      onClick={() => removePortNow(isEdit ? (p as InterfaceTemplateOut).id : (p as DraftPort)._key)}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
              {currentPorts.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={4}>
                    <Text c="dimmed" size="sm">Портов ещё нет</Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
          <Group align="flex-end">
            <Text size="sm" fw={600} pb={7} w={64}>№ {nextPortNumber}</Text>
            <TextInput
              label="Название порта" description="просто подпись, может повторяться"
              placeholder={`Порт ${nextPortNumber}`}
              value={portLabel} style={{ flex: 2 }}
              onChange={(e) => setPortLabel(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPortNow(); } }}
            />
            <Select
              label="Тип" placeholder="—" data={['access', 'trunk', 'uplink']} value={portType} onChange={setPortType}
              clearable style={{ flex: 1 }}
            />
            <Button variant="light" onClick={addPortNow}>+ Добавить</Button>
          </Group>
          <Group align="flex-end">
            <NumberInput label="N" value={genCount} onChange={(v) => setGenCount(v === '' ? '' : Number(v))} min={1} max={96} w={90} />
            <Button variant="light" onClick={generatePorts}>Сгенерировать N портов «Порт 1..N»</Button>
          </Group>

          <Group justify="flex-end" mt="sm">
            <Button type="submit" loading={pending}>{isEdit ? 'Сохранить' : 'Создать'}</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
