import { useState } from 'react';
import {
  Badge, Button, Group, NumberInput, Table, Text,
} from '@mantine/core';
import {
  IconChevronDown, IconChevronRight, IconExternalLink, IconPlus,
} from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { useAddInterface, useAddInterfacesBulk, useDeleteDevice, useDeviceInterfaces } from '../../api/hooks';
import { notifyError, notifySuccess } from '../../lib/notify';
import { confirmAction } from '../../lib/confirm';
import { DeleteAction, EditAction, RowAction } from '../../components/RowAction';
import { InterfaceRow } from './InterfaceRow';
import type { DeviceListItem, DeviceTemplateOut, DeviceTypeOut, VlanOut } from '../../api/types';
import { useCan } from '../../auth/permissions';

/** Строка спецификации оборудования и её порты.
 *
 * Раньше устройство было карточкой во всю ширину, и одинаковые сведения у
 * соседних устройств не выстраивались в столбцы — сравнить два станка можно
 * было только глазами по бегущему тексту. Порты по-прежнему подтягиваются
 * только у раскрытой строки: в списке из тысячи устройств они и составляли
 * почти весь вес страницы.
 */
export function DeviceRow({
  device, template, typeName, groupName, vlans, columns, onEdit,
}: {
  device: DeviceListItem;
  template: DeviceTemplateOut | undefined;
  typeName: string;
  groupName: string;
  vlans: VlanOut[];
  /** Сколько колонок в таблице — на столько растягивается строка с портами. */
  columns: number;
  onEdit: () => void;
}) {
  const canEdit = useCan('edit');
  const [open, setOpen] = useState(false);
  const [bulkCount, setBulkCount] = useState<number | ''>(24);
  const deleteDevice = useDeleteDevice();
  const addInterface = useAddInterface();
  const addPortsBulk = useAddInterfacesBulk();

  const portsEditable = template?.ports_editable_on_device ?? false;
  const { data: ifaces = [], isLoading: portsLoading } = useDeviceInterfaces(open ? device.id : null);

  async function handleDelete() {
    if (!(await confirmAction(`Удалить устройство "${device.code}" вместе со всеми его портами и связями?`))) return;
    deleteDevice.mutate(device.id, { onSuccess: () => notifySuccess('Устройство удалено'), onError: notifyError });
  }

  function addPort() {
    const n = device.ports_total + 1;
    addInterface.mutate({ deviceId: device.id, body: { label: `Порт ${n}` } }, { onError: notifyError });
  }

  async function generatePorts() {
    const n = typeof bulkCount === 'number' ? bulkCount : 0;
    if (n <= 0) return;
    if (!(await confirmAction(`Создать ${n} портов ("Порт 1".."Порт ${n}")?`))) return;
    addPortsBulk.mutate({ deviceId: device.id, body: { count: n } }, { onError: notifyError });
  }

  return (
    <>
      <Table.Tr style={{ cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <Table.Td>
          <Group gap={4} wrap="nowrap">
            {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            <Text size="sm" fw={700}>{device.code}</Text>
          </Group>
        </Table.Td>
        <Table.Td><Text size="sm">{device.name || <Text span c="dimmed">—</Text>}</Text></Table.Td>
        <Table.Td>
          <Group gap={6} wrap="nowrap">
            {template?.color && <span className="tag-badge-dot" style={{ background: template.color }} />}
            <Text size="sm">{template?.name ?? '—'}</Text>
          </Group>
        </Table.Td>
        <Table.Td><Text size="sm" c="dimmed">{typeName}</Text></Table.Td>
        <Table.Td><Text size="sm">{device.management_ip || '—'}</Text></Table.Td>
        <Table.Td><Text size="sm" c={device.mac ? undefined : 'dimmed'}>{device.mac || '—'}</Text></Table.Td>
        <Table.Td><Text size="sm" c={groupName === '—' ? 'dimmed' : undefined}>{groupName}</Text></Table.Td>
        <Table.Td>
          <Group gap={4}>
            {device.tags.map((t) => (
              <Badge key={t.id} size="xs" variant="outline" color={t.color ?? 'gray'}>{t.name}</Badge>
            ))}
            {device.tags.length === 0 && <Text size="sm" c="dimmed">—</Text>}
          </Group>
        </Table.Td>
        <Table.Td>
          <Text size="sm" c={device.ports_connected > 0 ? 'teal' : 'dimmed'} fw={600}>
            {device.ports_connected}/{device.ports_total}
          </Text>
        </Table.Td>
        <Table.Td onClick={(e) => e.stopPropagation()}>
          <Group gap={2} wrap="nowrap" justify="flex-end">
            <RowAction
              label={`Страница устройства «${device.code}»`}
              icon={<IconExternalLink size={15} />}
              component={Link}
              to={`/devices/${device.id}`}
            />
            {canEdit && (
              <>
                <EditAction label={`Изменить «${device.code}»`} onClick={onEdit} />
                <DeleteAction label={`Удалить «${device.code}»`} onClick={handleDelete} />
              </>
            )}
          </Group>
        </Table.Td>
      </Table.Tr>

      {open && (
        <Table.Tr>
          <Table.Td colSpan={columns} bg="var(--mantine-color-default-hover)">
            {device.notes && <Text size="sm" c="dimmed" mb={6}>{device.notes}</Text>}
            <Table withTableBorder verticalSpacing={4} bg="var(--mantine-color-body)">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={50}>№</Table.Th><Table.Th>Название</Table.Th><Table.Th>Разъём</Table.Th>
                  <Table.Th>Режим</Table.Th><Table.Th>VLAN</Table.Th>
                  <Table.Th>IP</Table.Th><Table.Th>MAC</Table.Th><Table.Th>Заметка</Table.Th>
                  <Table.Th>Подключение</Table.Th><Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {ifaces.map((i) => (
                  // Номер правки — в ключе, а не только в проверке на
                  // сохранении: строка держит поля формы в локальном
                  // состоянии, и без этого правка порта другим человеком не
                  // обновляла бы то, что видно на экране (ТЗ 1.6, остаток
                  // E10 сплошной проверки). Ключ меняется — React
                  // пересоздаёт строку заново со свежим снимком.
                  <InterfaceRow key={`${i.id}-${i.version}`} iface={i} vlans={vlans} portsEditable={portsEditable} />
                ))}
                {ifaces.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={10}>
                      <Text c="dimmed" size="sm">{portsLoading ? 'Загрузка портов…' : 'Портов ещё нет'}</Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
            {portsEditable && canEdit ? (
              <Group mt="xs">
                <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={addPort}>Порт</Button>
                <NumberInput
                  size="xs" value={bulkCount} onChange={(v) => setBulkCount(v === '' ? '' : Number(v))}
                  min={1} max={96} w={70}
                />
                <Button size="xs" variant="light" onClick={generatePorts}>Сгенерировать N портов</Button>
              </Group>
            ) : (
              <Text size="xs" c="dimmed" mt="xs">
                Состав портов задаётся моделью — правится в шаблоне «{template?.name}».
              </Text>
            )}
          </Table.Td>
        </Table.Tr>
      )}
    </>
  );
}

export function typeNameForTemplate(template: DeviceTemplateOut | undefined, types: DeviceTypeOut[]): string {
  if (!template) return '—';
  return types.find((t) => t.id === template.device_type_id)?.name ?? '—';
}
