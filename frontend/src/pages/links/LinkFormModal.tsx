import { useState } from 'react';
import { Button, Group, Modal, NumberInput, Select, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { useAttachLinkEnd, useDeleteLink, useFreePorts, useReconnectLinkEnd, useUpdateLink } from '../../api/hooks';
import { nn, nnFloat, nnInt } from '../../lib/utils';
import { notifyError, notifySuccess } from '../../lib/notify';
import { useCan } from '../../auth/permissions';
import type { FreePortOut, LinkEndOut, LinkOut, LinkTemplateOut } from '../../api/types';

/** Правка связи. Один и тот же диалог открывается со страницы «Связи» и по
 * клику на линию схемы — иначе пришлось бы держать две формы, которые
 * неизбежно разъедутся. */
export function LinkFormModal({
  link, templates, onClose,
}: {
  link: LinkOut;
  templates: LinkTemplateOut[];
  onClose: () => void;
}) {
  const canEdit = useCan('edit');
  const [templateId, setTemplateId] = useState<string | null>(link.template_id ? String(link.template_id) : null);
  const [connector, setConnector] = useState(link.connector_type ?? '');
  const [length, setLength] = useState<number | ''>(link.length_m ?? '');
  const [speed, setSpeed] = useState<number | ''>(link.speed_mbps ?? '');
  const [confirmed, setConfirmed] = useState(link.confirmed ? 'true' : 'false');
  const [notes, setNotes] = useState(link.notes ?? '');
  const [portA, setPortA] = useState<string | null>(link.interface_a_id ? String(link.interface_a_id) : null);
  const [portB, setPortB] = useState<string | null>(link.interface_b_id ? String(link.interface_b_id) : null);
  const updateLink = useUpdateLink();
  const reconnect = useReconnectLinkEnd();
  const attach = useAttachLinkEnd();
  const deleteLink = useDeleteLink();

  // Свободные порты ищет база; список нужен только тому, кто может править.
  const { data: freePorts = [] } = useFreePorts({ limit: 200 }, canEdit);
  const dangling = link.interface_a_id == null || link.interface_b_id == null;
  const pending = updateLink.isPending || reconnect.isPending || attach.isPending;

  /** Переставить один конец, если его поменяли. Подвешенный конец
   * подключается своим маршрутом: там переставлять нечего. */
  async function applyEnd(was: number | null, now: string | null) {
    const next = now ? parseInt(now, 10) : null;
    if (next == null || next === was) return;
    if (was == null) await attach.mutateAsync({ id: link.id, interfaceId: next });
    else await reconnect.mutateAsync({ id: link.id, from: was, to: next });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      // Концы переставляются по одному и до правки остальных полей: каждая
      // перестановка возвращает связь целиком, и порядок сторон в ней мог
      // поменяться — стороны хранятся по возрастанию id.
      await applyEnd(link.interface_a_id, portA);
      await applyEnd(link.interface_b_id, portB);
      await updateLink.mutateAsync({
        id: link.id,
        body: {
          template_id: nnInt(templateId),
          connector_type: nn(connector),
          length_m: nnFloat(length === '' ? null : String(length)),
          speed_mbps: nnInt(speed === '' ? null : String(speed)),
          confirmed: confirmed === 'true',
          notes: nn(notes),
        },
      });
      notifySuccess('Связь обновлена');
      onClose();
    } catch (error) {
      notifyError(error);
    }
  }

  function handleDelete() {
    if (!confirm('Удалить связь? Оба порта снова станут свободными.')) return;
    deleteLink.mutate(link.id, {
      onSuccess: () => { notifySuccess('Связь удалена'); onClose(); },
      onError: notifyError,
    });
  }

  return (
    <Modal opened onClose={onClose} title="Изменить связь" size="lg">
      <form onSubmit={handleSubmit}>
        <Stack>
          {dangling && (
            <Text size="sm" c="orange">
              Один конец этой связи подвешен: порт удалили, а кабель остался. Выберите ему свободный порт —
              связь останется той же, с её длиной, разъёмом и заметками.
            </Text>
          )}
          {/* Концы кабеля правятся здесь же: кабель записали не в тот порт,
              или железку перекоммутировали в соседнее гнездо — заводить
              связь заново ради этого незачем. */}
          <Group grow align="flex-start">
            <Select
              label="Порт A" placeholder="— выбрать свободный —" searchable clearable={false}
              disabled={!canEdit}
              data={portOptions(freePorts, link.end_a)}
              value={portA} onChange={setPortA}
            />
            <Select
              label="Порт B" placeholder="— выбрать свободный —" searchable clearable={false}
              disabled={!canEdit}
              data={portOptions(freePorts, link.end_b)}
              value={portB} onChange={setPortB}
            />
          </Group>
          <Select
            label="Шаблон связи" placeholder="— без шаблона —"
            data={templates.map((t) => ({ value: String(t.id), label: t.name }))}
            value={templateId} onChange={setTemplateId} clearable
          />
          <Group grow>
            <TextInput label="Разъём" placeholder="RJ45 / LC..." value={connector} onChange={(e) => setConnector(e.currentTarget.value)} />
            <NumberInput label="Длина, м" value={length} onChange={(v) => setLength(v === '' ? '' : Number(v))} decimalScale={1} />
          </Group>
          <Group grow>
            <NumberInput label="Скорость, Мбит/с" value={speed} onChange={(v) => setSpeed(v === '' ? '' : Number(v))} />
            <Select
              label="Подтверждена"
              data={[{ value: 'true', label: 'да' }, { value: 'false', label: 'нет' }]}
              value={confirmed} onChange={(v) => setConfirmed(v ?? 'true')}
            />
          </Group>
          <Textarea label="Заметки" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} rows={2} />
          <Group justify="space-between" mt="sm">
            <Button
              variant="light" color="red" leftSection={<IconTrash size={16} />}
              onClick={handleDelete} loading={deleteLink.isPending}
            >
              Удалить связь
            </Button>
            <Button type="submit" loading={pending}>Сохранить</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** Свободные порты, сгруппированные по устройствам, плюс тот, в котором
 * конец сидит сейчас: занятый порт в списке свободных не значится, а
 * показать выбранное значение чем-то надо. */
function portOptions(free: FreePortOut[], current: LinkEndOut | null | undefined) {
  const groups = new Map<number, { group: string; items: { value: string; label: string }[] }>();
  const add = (deviceId: number, deviceCode: string, deviceName: string | null,
                interfaceId: number, portNumber: number, label: string) => {
    if (!groups.has(deviceId)) {
      groups.set(deviceId, {
        group: deviceName ? `${deviceCode} — ${deviceName}` : deviceCode,
        items: [],
      });
    }
    groups.get(deviceId)!.items.push({ value: String(interfaceId), label: `№${portNumber} · ${label}` });
  };

  if (current) {
    add(current.device_id, current.device_code, current.device_name,
        current.interface_id, current.port_number, `${current.interface_label} (сейчас)`);
  }
  for (const port of free) {
    // Тот же порт вторым пунктом не нужен: сразу после перестановки конца
    // прежний порт освобождается и приезжает в списке свободных, а Mantine
    // на двух одинаковых значениях роняет страницу целиком.
    if (current && port.interface_id === current.interface_id) continue;
    add(port.device_id, port.device_code, port.device_name, port.interface_id, port.port_number, port.label);
  }
  return [...groups.values()];
}
