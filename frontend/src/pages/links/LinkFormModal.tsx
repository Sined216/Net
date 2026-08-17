import { useState } from 'react';
import { Button, Group, Modal, NumberInput, Select, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconTrash } from '@tabler/icons-react';
import { useAttachLinkEnd, useDeleteLink, useFreePorts, useReconnectLinkEnd, useUpdateLink } from '../../api/hooks';
import { deviceLabel, nn, nnFloat, nnInt } from '../../lib/utils';
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

  // Свободные порты ищет база. Список собирается из двух источников: порты
  // своего же устройства — их должно быть видно всегда, а не только когда
  // повезёт попасть в первые limit записей общего списка (ради этого и
  // затевалось — иначе переставить кабель на соседний порт той же железки
  // было нечем); и порты, найденные поиском — для случая, когда конец
  // переносится на другое устройство целиком.
  const [searchA, setSearchA] = useState('');
  const [searchB, setSearchB] = useState('');
  const [debouncedSearchA] = useDebouncedValue(searchA, 300);
  const [debouncedSearchB] = useDebouncedValue(searchB, 300);
  const deviceAId = link.end_a?.device_id ?? null;
  const deviceBId = link.end_b?.device_id ?? null;

  const { data: ownA = [] } = useFreePorts({ device_id: deviceAId ?? undefined, limit: 200 }, canEdit && deviceAId != null);
  const { data: ownB = [] } = useFreePorts({ device_id: deviceBId ?? undefined, limit: 200 }, canEdit && deviceBId != null);
  const { data: foundA = [] } = useFreePorts(
    { q: debouncedSearchA, limit: 50 }, canEdit && debouncedSearchA.trim().length >= 2,
  );
  const { data: foundB = [] } = useFreePorts(
    { q: debouncedSearchB, limit: 50 }, canEdit && debouncedSearchB.trim().length >= 2,
  );
  const freeA = mergeFree(ownA, foundA);
  const freeB = mergeFree(ownB, foundB);
  const dangling = link.interface_a_id == null || link.interface_b_id == null;
  const pending = updateLink.isPending || reconnect.isPending || attach.isPending;

  /** Переставить один конец, если его поменяли. Подвешенный конец
   * подключается своим маршрутом: там переставлять нечего. */
  async function applyEnd(was: number | null | undefined, now: string | null): Promise<boolean> {
    const next = now ? parseInt(now, 10) : null;
    if (next == null || next === was) return false;
    if (was == null) await attach.mutateAsync({ id: link.id, interfaceId: next });
    else await reconnect.mutateAsync({ id: link.id, from: was, to: next });
    return true;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      // Концы переставляются по одному и до правки остальных полей: каждая
      // перестановка возвращает связь целиком, и порядок сторон в ней мог
      // поменяться — стороны хранятся по возрастанию id.
      const movedA = await applyEnd(link.interface_a_id, portA);
      const movedB = await applyEnd(link.interface_b_id, portB);
      const movedEnd = movedA || movedB;
      await updateLink.mutateAsync({
        id: link.id,
        body: {
          // Перестановка конца выше уже подняла номер правки, поэтому
          // сверяться с исходным здесь нельзя — он заведомо устарел.
          version: movedEnd ? undefined : link.version,
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
              data={portOptions(freeA, link.end_a)}
              value={portA} onChange={setPortA}
              searchValue={searchA} onSearchChange={setSearchA}
              // Свои порты видны всегда, а не только когда их подпись
              // совпала с введённым текстом: без этого набранный код
              // другого устройства прятал бы порты того же устройства.
              filter={({ options }) => options}
            />
            <Select
              label="Порт B" placeholder="— выбрать свободный —" searchable clearable={false}
              disabled={!canEdit}
              data={portOptions(freeB, link.end_b)}
              value={portB} onChange={setPortB}
              searchValue={searchB} onSearchChange={setSearchB}
              filter={({ options }) => options}
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

/** Объединить несколько списков свободных портов в один без повторов:
 * порт своего устройства и порт, найденный тем же запросом поиска,
 * приезжают отдельными ответами и могут пересекаться. */
function mergeFree(...lists: FreePortOut[][]): FreePortOut[] {
  const seen = new Set<number>();
  const out: FreePortOut[] = [];
  for (const list of lists) {
    for (const port of list) {
      if (seen.has(port.interface_id)) continue;
      seen.add(port.interface_id);
      out.push(port);
    }
  }
  return out;
}

/** Свободные порты, сгруппированные по устройствам, плюс тот, в котором
 * конец сидит сейчас: занятый порт в списке свободных не значится, а
 * показать выбранное значение чем-то надо. */
function portOptions(free: FreePortOut[], current: LinkEndOut | null | undefined) {
  const groups = new Map<number, { group: string; items: { value: string; label: string }[] }>();
  const add = (deviceId: number, deviceCode: string, deviceName: string | null | undefined,
                templateName: string | null | undefined,
                interfaceId: number, portNumber: number, label: string) => {
    if (!groups.has(deviceId)) {
      groups.set(deviceId, { group: deviceLabel(deviceCode, deviceName, templateName), items: [] });
    }
    groups.get(deviceId)!.items.push({ value: String(interfaceId), label: `№${portNumber} · ${label}` });
  };

  if (current) {
    add(current.device_id, current.device_code, current.device_name, current.device_template_name,
        current.interface_id, current.port_number, `${current.interface_label} (сейчас)`);
  }
  for (const port of free) {
    // Тот же порт вторым пунктом не нужен: сразу после перестановки конца
    // прежний порт освобождается и приезжает в списке свободных, а Mantine
    // на двух одинаковых значениях роняет страницу целиком.
    if (current && port.interface_id === current.interface_id) continue;
    add(port.device_id, port.device_code, port.device_name, port.device_template_name,
        port.interface_id, port.port_number, port.label);
  }
  return [...groups.values()];
}
