import { useEffect, useRef, useState } from 'react';
import {
  Badge, Button, Group, Modal, NumberInput, Select, Stack,
  Table, Text, TextInput, Textarea, Title, Card, Collapse, ColorInput, Switch, Alert, UnstyledButton,
} from '@mantine/core';
import {
  IconChevronDown, IconChevronRight, IconCopy, IconPlus,
} from '@tabler/icons-react';
import { DeleteAction, EditAction, RowAction } from '../components/RowAction';
import {
  useAddTemplateInterface, useAddTemplateInterfacesBulk, useConnectorTypes, useCopyDeviceTemplate, useCreateDeviceTemplate, useTemplateImpact,
  useDeleteDeviceTemplate, useDeleteTemplateInterface, useDeviceTemplates, useDeviceTypes,
  useUpdateDeviceTemplate, useUpdateTemplateInterface,
} from '../api/hooks';
import { nn } from '../lib/utils';
import { notifyError, notifySuccess } from '../lib/notify';
import { confirmAction } from '../lib/confirm';
import type { ConnectorTypeOut, DeviceTemplateOut, InterfaceTemplateOut } from '../api/types';
import { useCan } from '../auth/permissions';
import { EquipmentTabs } from './equipment/EquipmentTabs';

export function TemplatesPage() {
  const canEdit = useCan('edit');
  // Модель техники — справочник общий для всех площадок, удалять её вправе
  // только admin (см. тот же довод на сервере, routers/templates.py). Состав
  // портов внутри модели по-прежнему правит редактор — это не удаление
  // самого справочника.
  const canAdmin = useCan('admin');
  const { data: types = [] } = useDeviceTypes();
  const { data: templates = [], isLoading } = useDeviceTemplates();
  const [editingTemplate, setEditingTemplate] = useState<DeviceTemplateOut | 'new' | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  /** Раскрытый тип устройств. Открыт один: типов немного, и раскрытые все
   * сразу — это тот же сплошной список, от которого группировка и спасает. */
  const [openType, setOpenType] = useState<number | null>(null);
  const deleteTemplate = useDeleteDeviceTemplate();
  const copyTemplate = useCopyDeviceTemplate();
  const { data: connectors = [] } = useConnectorTypes();

  // Шаблоны по типам техники: коммутаторы отдельно, станки отдельно. Тип без
  // единого шаблона не показывается — пустой заголовок только мешает.
  const byType = [
    ...types.map((type) => ({ type, list: templates.filter((t) => t.device_type_id === type.id) })),
    { type: undefined, list: templates.filter((t) => !types.some((x) => x.id === t.device_type_id)) },
  ]
    .filter(({ list }) => list.length > 0)
    .map(({ type, list }) => ({
      type,
      list,
      devices: list.reduce((sum, t) => sum + t.devices_count, 0),
    }));

  return (
    <Stack>
      <EquipmentTabs />
      <Group justify="space-between">
        <Title order={2}>Шаблоны устройств</Title>
        {canEdit && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditingTemplate('new')}>
            Шаблон
          </Button>
        )}
      </Group>
      <Text c="dimmed" size="sm">
        Шаблон описывает модель техники: тип и набор портов. При добавлении устройства в спецификацию оборудования его
        порты копируются из шаблона. Число рядом с названием — сколько устройств этой модели заведено на площадке.
      </Text>

      {byType.map(({ type, list, devices }) => (
        <div key={type?.id ?? 'none'}>
          <UnstyledButton
            onClick={() => setOpenType(openType === (type?.id ?? 0) ? null : (type?.id ?? 0))}
            style={{ width: '100%' }}
          >
            <Group gap="xs" py={4}>
              {openType === (type?.id ?? 0) ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
              <Text fw={700}>{type?.name ?? 'Без типа'}</Text>
              <Badge variant="light" color="gray">{list.length} шаблон(ов)</Badge>
              <Badge variant="light" color={devices > 0 ? 'teal' : 'gray'}>{devices} устройств(а)</Badge>
            </Group>
          </UnstyledButton>
          <Collapse expanded={openType === (type?.id ?? 0)}>
            <Stack gap="xs" mt="xs" ml="md">
              {list.map((tpl) => (
                <Card key={tpl.id} withBorder padding="sm">
                  <Group justify="space-between">
                    <UnstyledButton onClick={() => setExpanded(expanded === tpl.id ? null : tpl.id)} style={{ flex: 1 }}>
                      <Group gap="xs">
                        {expanded === tpl.id ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                        <Text fw={600}>{tpl.name}</Text>
                        {tpl.color && <span className="tag-badge-dot" style={{ background: tpl.color }} />}
                        {tpl.manufacturer && <Text c="dimmed">{tpl.manufacturer}</Text>}
                        <Badge variant="light" color="gray">{tpl.interfaces.length} порт(ов)</Badge>
                        <Badge variant="light" color={tpl.devices_count > 0 ? 'teal' : 'gray'}>
                          {tpl.devices_count} устройств(а)
                        </Badge>
                      </Group>
                    </UnstyledButton>
                    {canEdit && (
                      <Group gap={4}>
                        <EditAction label={`Изменить шаблон «${tpl.name}»`} onClick={() => setEditingTemplate(tpl)} />
                        <RowAction
                          label={`Копия шаблона «${tpl.name}» со всеми портами`}
                          icon={<IconCopy size={16} />}
                          onClick={() => copyTemplate.mutate(tpl.id, {
                            onSuccess: (created) => notifySuccess(`Создан шаблон «${created.name}»`),
                            onError: notifyError,
                          })}
                        />
                        {canAdmin && (
                          <DeleteAction
                            label={`Удалить шаблон «${tpl.name}»`}
                            onClick={async () => {
                              if (!(await confirmAction(`Удалить шаблон "${tpl.name}"?`))) return;
                              deleteTemplate.mutate(tpl.id, { onSuccess: () => notifySuccess('Шаблон удалён'), onError: notifyError });
                            }}
                          />
                        )}
                      </Group>
                    )}
                  </Group>
                  <Collapse expanded={expanded === tpl.id}>
                    <Stack mt="sm" gap={4}>
                      {tpl.notes && <Text size="sm" c="dimmed">{tpl.notes}</Text>}
                      <Table withTableBorder verticalSpacing={4}>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th w={60}>№</Table.Th>
                            <Table.Th>Название</Table.Th>
                            <Table.Th>Разъём</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {tpl.interfaces.map((i) => (
                            <Table.Tr key={i.id}>
                              <Table.Td fw={600}>{i.port_number}</Table.Td>
                              <Table.Td>{i.label}</Table.Td>
                              <Table.Td>{connectors.find((c) => c.id === i.connector_id)?.name ?? '—'}</Table.Td>
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
            </Stack>
          </Collapse>
        </div>
      ))}
      {!isLoading && templates.length === 0 && <Text c="dimmed">Шаблонов ещё нет — начните с добавления хотя бы одного.</Text>}

      {editingTemplate && (
        <TemplateFormModal template={editingTemplate === 'new' ? null : editingTemplate} onClose={() => setEditingTemplate(null)} />
      )}
    </Stack>
  );
}

interface DraftPort {
  _key: number;
  /** Номер — место порта в ряду гнёзд; его раздаёт сервер, а в черновике
   * он равен позиции в списке. */
  port_number: number;
  label: string;
  connector_id: number | null;
}

/** Форма шаблона — создание и редактирование в одном месте. В режиме
 * создания порты копятся в черновике и уходят одним запросом при сабмите;
 * в режиме редактирования каждое изменение порта сразу летит на бэкенд. */
export function TemplateFormModal({ template, draftName, onClose, onCreated }: {
  template: DeviceTemplateOut | null;
  /** Название для нового шаблона — например взятое из строки файла импорта. */
  draftName?: string;
  onClose: () => void;
  /** Заведённый шаблон — например, окну заведения устройства, открывшему
   * это окно кнопкой «создать шаблон», нужно сразу его выбрать. */
  onCreated?: (templateId: number) => void;
}) {
  const isEdit = !!template;
  const { data: types = [] } = useDeviceTypes();
  const { data: templates = [] } = useDeviceTemplates();
  const { data: connectors = [] } = useConnectorTypes();
  const [name, setName] = useState(template?.name ?? draftName ?? '');
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
  // Разъём по умолчанию — RJ45: на заводе это подавляющее большинство портов.
  const defaultConnectorId = connectors.find((c) => c.name === 'RJ45')?.id ?? connectors[0]?.id ?? null;
  const [portConnector, setPortConnector] = useState<string | null>(null);
  const [genCount, setGenCount] = useState<number | ''>(24);

  const createTemplate = useCreateDeviceTemplate();
  const updateTemplate = useUpdateDeviceTemplate();
  const addPort = useAddTemplateInterface();
  const addPortsBulk = useAddTemplateInterfacesBulk();
  const removePort = useDeleteTemplateInterface();
  const updatePort = useUpdateTemplateInterface();

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
    const connectorId = portConnector ? parseInt(portConnector, 10) : defaultConnectorId;
    if (isEdit) {
      addPort.mutate({ templateId: template!.id, body: { label, connector_id: connectorId } }, { onError: notifyError });
    } else {
      draftSeq.current += 1;
      setDraftPorts((prev) => [...prev, { _key: draftSeq.current, port_number: number, label, connector_id: connectorId }]);
    }
    setPortLabel('');
  }

  function generatePorts() {
    const n = typeof genCount === 'number' ? genCount : 0;
    if (n <= 0) return;
    const start = currentPorts.length;
    if (isEdit) {
      // Одним запросом: по одному и параллельно они читают один и тот же
      // «следующий номер», и из восьми портов доезжали два.
      addPortsBulk.mutate(
        { templateId: template!.id, body: { count: n, connector_id: defaultConnectorId } },
        { onError: notifyError },
      );
    } else {
      const newPorts: DraftPort[] = [];
      for (let i = 1; i <= n; i++) {
        draftSeq.current += 1;
        newPorts.push({
          _key: draftSeq.current, port_number: start + i,
          label: `Порт ${start + i}`, connector_id: defaultConnectorId,
        });
      }
      setDraftPorts((prev) => [...prev, ...newPorts]);
    }
  }

  /** Правка порта прямо в строке: у черновика — в состоянии формы, у
   * сохранённой модели — запросом, который доезжает до всех её устройств. */
  function changePort(port: InterfaceTemplateOut | DraftPort, patch: { label?: string; connector_id?: number | null }) {
    if (isEdit) {
      updatePort.mutate(
        { templateId: template!.id, ifaceId: (port as InterfaceTemplateOut).id, body: patch },
        { onError: notifyError },
      );
    } else {
      const key = (port as DraftPort)._key;
      setDraftPorts((prev) => prev.map((p) => (p._key === key ? { ...p, ...patch } : p)));
    }
  }

  async function removePortNow(key: number) {
    if (isEdit) {
      if (!(await confirmAction('Убрать порт из модели? Он исчезнет у всех устройств этой модели; кабели, воткнутые в него, останутся с подвешенным концом.'))) return;
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
    if (isEdit) {
      updateTemplate.mutate(
        { id: template!.id, body },
        { onSuccess: () => { notifySuccess('Шаблон обновлён'); onClose(); }, onError: notifyError },
      );
    } else {
      createTemplate.mutate(
        { ...body, interfaces: draftPorts.map(({ label, connector_id }) => ({ label, connector_id })) },
        {
          onSuccess: (created) => {
            notifySuccess('Шаблон создан');
            onCreated?.(created.id);
            onClose();
          },
          onError: notifyError,
        },
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
                <Table.Th>Разъём</Table.Th>
                <Table.Th w={44} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {[...currentPorts].sort((a, b) => a.port_number - b.port_number).map((p) => (
                <PortRow
                  key={isEdit ? (p as InterfaceTemplateOut).id : (p as DraftPort)._key}
                  port={p}
                  connectors={connectors}
                  onChange={(patch) => changePort(p, patch)}
                  onRemove={() => removePortNow(isEdit ? (p as InterfaceTemplateOut).id : (p as DraftPort)._key)}
                />
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
              label="Разъём" placeholder={connectorName(connectors, defaultConnectorId)} style={{ flex: 1 }}
              data={connectors.map((c) => ({ value: String(c.id), label: c.name }))}
              value={portConnector} onChange={setPortConnector} clearable searchable
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


/** Название разъёма по id — в нескольких местах подряд. */
function connectorName(connectors: ConnectorTypeOut[], id: number | null | undefined): string {
  return connectors.find((c) => c.id === id)?.name ?? '—';
}


/** Строка порта в шаблоне: название и разъём правятся прямо здесь.
 *
 * Название сохраняется по уходу из поля, а не на каждую букву: у
 * сохранённой модели каждая правка — запрос, который доезжает до всех её
 * устройств, и слать его на каждое нажатие клавиши незачем.
 */
function PortRow({ port, connectors, onChange, onRemove }: {
  port: InterfaceTemplateOut | DraftPort;
  connectors: ConnectorTypeOut[];
  onChange: (patch: { label?: string; connector_id?: number | null }) => void;
  onRemove: () => void;
}) {
  const [label, setLabel] = useState(port.label);

  // Название могло измениться снаружи — например правкой из другой вкладки.
  useEffect(() => { setLabel(port.label); }, [port.label]);

  function commitLabel() {
    const next = label.trim();
    if (!next || next === port.label) { setLabel(port.label); return; }
    onChange({ label: next });
  }

  return (
    <Table.Tr>
      <Table.Td fw={600}>{port.port_number}</Table.Td>
      <Table.Td>
        <TextInput
          size="xs" value={label}
          onChange={(e) => setLabel(e.currentTarget.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
            if (e.key === 'Escape') setLabel(port.label);
          }}
        />
      </Table.Td>
      <Table.Td>
        <Select
          size="xs" placeholder="— не указан —" clearable searchable
          // Повторный клик по уже выбранному разъёму не должен его снимать:
          // это выглядит как случайная потеря значения. Для очистки есть
          // крестик.
          allowDeselect={false}
          data={connectors.map((c) => ({ value: String(c.id), label: c.name }))}
          value={port.connector_id != null ? String(port.connector_id) : null}
          onChange={(value) => onChange({ connector_id: value ? parseInt(value, 10) : null })}
        />
      </Table.Td>
      <Table.Td>
        <Group gap={2} wrap="nowrap" justify="flex-end">
          <DeleteAction label={`Убрать порт №${port.port_number}`} size={14} onClick={onRemove} />
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}
