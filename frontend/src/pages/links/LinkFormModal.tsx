import { useState } from 'react';
import { Button, Group, Modal, NumberInput, Select, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { useDeleteLink, useUpdateLink } from '../../api/hooks';
import { nn, nnFloat, nnInt } from '../../lib/utils';
import { notifyError, notifySuccess } from '../../lib/notify';
import type { LinkOut, LinkTemplateOut } from '../../api/types';

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
  const [templateId, setTemplateId] = useState<string | null>(link.template_id ? String(link.template_id) : null);
  const [connector, setConnector] = useState(link.connector_type ?? '');
  const [length, setLength] = useState<number | ''>(link.length_m ?? '');
  const [speed, setSpeed] = useState<number | ''>(link.speed_mbps ?? '');
  const [confirmed, setConfirmed] = useState(link.confirmed ? 'true' : 'false');
  const [notes, setNotes] = useState(link.notes ?? '');
  const updateLink = useUpdateLink();
  const deleteLink = useDeleteLink();

  const dangling = link.interface_a_id == null || link.interface_b_id == null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateLink.mutate(
      {
        id: link.id,
        body: {
          template_id: nnInt(templateId),
          connector_type: nn(connector),
          length_m: nnFloat(length === '' ? null : String(length)),
          speed_mbps: nnInt(speed === '' ? null : String(speed)),
          confirmed: confirmed === 'true',
          notes: nn(notes),
        },
      },
      { onSuccess: () => { notifySuccess('Связь обновлена'); onClose(); }, onError: notifyError },
    );
  }

  function handleDelete() {
    if (!confirm('Удалить связь? Оба порта снова станут свободными.')) return;
    deleteLink.mutate(link.id, {
      onSuccess: () => { notifySuccess('Связь удалена'); onClose(); },
      onError: notifyError,
    });
  }

  return (
    <Modal opened onClose={onClose} title="Изменить связь">
      <form onSubmit={handleSubmit}>
        <Stack>
          {dangling && (
            <Text size="sm" c="orange">
              Один конец этой связи подвешен: порт удалили, а кабель остался. Подключить его заново
              можно у любого свободного порта, в строке порта на странице устройства.
            </Text>
          )}
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
            <Button type="submit" loading={updateLink.isPending}>Сохранить</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
