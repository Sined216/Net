import { useMemo, useState } from 'react';
import {
  ActionIcon, Badge, Button, ColorInput, Group, Modal, NumberInput, Select,
  Stack, Table, Text, TextInput, Textarea, Title,
} from '@mantine/core';
import { IconEdit, IconPlus, IconTrash } from '@tabler/icons-react';
import {
  useCreateLinkTemplate, useDeleteLink, useDeleteLinkTemplate, useDevices,
  useLinkTemplates, useLinks, useUpdateLink, useUpdateLinkTemplate,
} from '../api/hooks';
import { nn, nnFloat, nnInt } from '../lib/utils';
import { notifyError, notifySuccess } from '../lib/notify';
import type { DeviceOut, LinkOut, LinkTemplateOut, MediaType, LineStyle } from '../api/types';

const MEDIA_TYPES: MediaType[] = ['copper', 'fiber', 'wireless', 'dac', 'other'];
const LINE_STYLES: LineStyle[] = ['solid', 'dashed', 'dotted'];

function useIfaceMap(devices: DeviceOut[]) {
  return useMemo(() => {
    const map = new Map<number, { device: DeviceOut; label: string }>();
    for (const d of devices) for (const i of d.interfaces) map.set(i.id, { device: d, label: i.label });
    return map;
  }, [devices]);
}

export function LinksPage() {
  const { data: linkTemplates = [] } = useLinkTemplates();
  const { data: links = [] } = useLinks();
  const { data: devices = [] } = useDevices();
  const ifaceMap = useIfaceMap(devices);
  const [ltModalOpen, setLtModalOpen] = useState(false);
  const [editingLt, setEditingLt] = useState<LinkTemplateOut | null>(null);
  const [editingLink, setEditingLink] = useState<LinkOut | null>(null);
  const deleteLt = useDeleteLinkTemplate();
  const deleteLink = useDeleteLink();

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Шаблоны связей</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setLtModalOpen(true)}>
          Шаблон связи
        </Button>
      </Group>
      <Text c="dimmed" size="sm">
        Шаблон задаёт среду передачи, категорию кабеля и оформление на топологии (цвет, стиль линии). Длина и разъём —
        свойства конкретной связи, в шаблон не входят.
      </Text>
      <Table withTableBorder verticalSpacing="xs" mb="md">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Название</Table.Th>
            <Table.Th>Среда</Table.Th>
            <Table.Th>Категория</Table.Th>
            <Table.Th>Цвет</Table.Th>
            <Table.Th>Линия</Table.Th>
            <Table.Th w={80} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {linkTemplates.map((t) => (
            <Table.Tr key={t.id}>
              <Table.Td>{t.name}</Table.Td>
              <Table.Td>{t.media_type}</Table.Td>
              <Table.Td>{t.cable_category || '—'}</Table.Td>
              <Table.Td><span className="tag-badge-dot" style={{ background: t.color }} />{t.color}</Table.Td>
              <Table.Td>{t.line_style}</Table.Td>
              <Table.Td>
                <Group gap={4}>
                  <ActionIcon variant="subtle" onClick={() => setEditingLt(t)}><IconEdit size={16} /></ActionIcon>
                  <ActionIcon
                    variant="subtle" color="red"
                    onClick={() => {
                      if (!confirm('Удалить шаблон связи? У существующих связей с этим шаблоном он просто снимется, сами связи останутся.')) return;
                      deleteLt.mutate(t.id, { onSuccess: () => notifySuccess('Шаблон связи удалён'), onError: notifyError });
                    }}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
          {linkTemplates.length === 0 && (
            <Table.Tr><Table.Td colSpan={6}><Text c="dimmed">Шаблонов связи ещё нет</Text></Table.Td></Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      <Title order={2}>Связи между портами</Title>
      <Text c="dimmed" size="sm">
        Новую связь создавайте перетаскиванием на схеме или прямо у порта устройства — здесь можно назначить
        шаблон, уточнить длину/разъём или удалить связь. «Подвешен» означает, что порт на этом конце удалили
        (например сняли сетевую карту), а кабель остался: подключить его заново можно у любого свободного порта.
      </Text>
      <Table withTableBorder verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Устройство A</Table.Th><Table.Th>Порт A</Table.Th>
            <Table.Th>Устройство B</Table.Th><Table.Th>Порт B</Table.Th>
            <Table.Th>Шаблон</Table.Th><Table.Th>Разъём</Table.Th><Table.Th>Длина, м</Table.Th>
            <Table.Th>Источник</Table.Th><Table.Th>Подтв.</Table.Th><Table.Th w={80} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {links.map((l) => {
            // Конец может пустовать: порт удалили (сняли сетевую карту), а
            // кабель остался проложен.
            const a = l.interface_a_id != null ? ifaceMap.get(l.interface_a_id) : undefined;
            const b = l.interface_b_id != null ? ifaceMap.get(l.interface_b_id) : undefined;
            const dangling = l.interface_a_id == null || l.interface_b_id == null;
            const lt = l.template_id ? linkTemplates.find((t) => t.id === l.template_id) : null;
            return (
              <Table.Tr key={l.id}>
                <Table.Td>{a?.device.code ?? <DanglingEnd />}</Table.Td>
                <Table.Td>{a?.label ?? '—'}</Table.Td>
                <Table.Td>{b?.device.code ?? <DanglingEnd />}</Table.Td>
                <Table.Td>{b?.label ?? '—'}</Table.Td>
                <Table.Td>
                  {lt ? (<><span className="tag-badge-dot" style={{ background: lt.color }} />{lt.name}</>) : <Text c="dimmed">— без шаблона —</Text>}
                </Table.Td>
                <Table.Td>{l.connector_type || '—'}</Table.Td>
                <Table.Td>{l.length_m ?? '—'}</Table.Td>
                <Table.Td>{l.source}</Table.Td>
                <Table.Td>
                  {dangling
                    ? <Badge color="orange" variant="light">подвешен</Badge>
                    : l.confirmed ? '✓' : <Badge color="yellow" variant="light">не подтв.</Badge>}
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    <ActionIcon variant="subtle" onClick={() => setEditingLink(l)}><IconEdit size={16} /></ActionIcon>
                    <ActionIcon
                      variant="subtle" color="red"
                      onClick={() => {
                        if (!confirm('Удалить связь? Оба порта снова станут свободными.')) return;
                        deleteLink.mutate(l.id, { onSuccess: () => notifySuccess('Связь удалена'), onError: notifyError });
                      }}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            );
          })}
          {links.length === 0 && (
            <Table.Tr><Table.Td colSpan={10}><Text c="dimmed">Связей ещё нет</Text></Table.Td></Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      {(ltModalOpen || editingLt) && (
        <LinkTemplateFormModal template={editingLt} onClose={() => { setLtModalOpen(false); setEditingLt(null); }} />
      )}
      {editingLink && <LinkFormModal link={editingLink} templates={linkTemplates} onClose={() => setEditingLink(null)} />}
    </Stack>
  );
}

/** Конец связи, у которого удалили порт: кабель остался, втыкать некуда. */
function DanglingEnd() {
  return <Text c="orange" size="sm">— не подключён —</Text>;
}

function LinkTemplateFormModal({ template, onClose }: { template: LinkTemplateOut | null; onClose: () => void }) {
  const isEdit = !!template;
  const [name, setName] = useState(template?.name ?? '');
  const [media, setMedia] = useState<string>(template?.media_type ?? 'copper');
  const [cable, setCable] = useState(template?.cable_category ?? '');
  const [color, setColor] = useState(template?.color ?? '#888888');
  const [lineStyle, setLineStyle] = useState<string>(template?.line_style ?? 'solid');
  const createLt = useCreateLinkTemplate();
  const updateLt = useUpdateLinkTemplate();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = { name: name.trim(), media_type: media as MediaType, cable_category: nn(cable), color, line_style: lineStyle as LineStyle };
    const onSuccess = () => { notifySuccess(isEdit ? 'Шаблон связи обновлён' : 'Шаблон связи создан'); onClose(); };
    if (isEdit) updateLt.mutate({ id: template!.id, body }, { onSuccess, onError: notifyError });
    else createLt.mutate(body, { onSuccess, onError: notifyError });
  }

  return (
    <Modal opened onClose={onClose} title={isEdit ? `Шаблон связи: ${template!.name}` : 'Новый шаблон связи'}>
      <form onSubmit={handleSubmit}>
        <Stack>
          <TextInput label="Название" placeholder="напр. Медь Cat6" value={name} onChange={(e) => setName(e.currentTarget.value)} required autoFocus />
          <Group grow>
            <Select label="Среда" data={MEDIA_TYPES} value={media} onChange={(v) => setMedia(v ?? 'copper')} required />
            <TextInput label="Категория кабеля" placeholder="cat6 / OM4..." value={cable} onChange={(e) => setCable(e.currentTarget.value)} />
          </Group>
          <Group grow>
            <ColorInput label="Цвет на топологии" value={color} onChange={setColor} />
            <Select label="Стиль линии" data={LINE_STYLES} value={lineStyle} onChange={(v) => setLineStyle(v ?? 'solid')} />
          </Group>
          <Group justify="flex-end" mt="sm">
            <Button type="submit" loading={createLt.isPending || updateLt.isPending}>{isEdit ? 'Сохранить' : 'Создать'}</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function LinkFormModal({ link, templates, onClose }: { link: LinkOut; templates: LinkTemplateOut[]; onClose: () => void }) {
  const [templateId, setTemplateId] = useState<string | null>(link.template_id ? String(link.template_id) : null);
  const [connector, setConnector] = useState(link.connector_type ?? '');
  const [length, setLength] = useState<number | ''>(link.length_m ?? '');
  const [speed, setSpeed] = useState<number | ''>(link.speed_mbps ?? '');
  const [confirmed, setConfirmed] = useState(link.confirmed ? 'true' : 'false');
  const [notes, setNotes] = useState(link.notes ?? '');
  const updateLink = useUpdateLink();

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

  return (
    <Modal opened onClose={onClose} title="Изменить связь">
      <form onSubmit={handleSubmit}>
        <Stack>
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
            <Select label="Подтверждена" data={[{ value: 'true', label: 'да' }, { value: 'false', label: 'нет' }]} value={confirmed} onChange={(v) => setConfirmed(v ?? 'true')} />
          </Group>
          <Textarea label="Заметки" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} rows={2} />
          <Group justify="flex-end" mt="sm">
            <Button type="submit" loading={updateLink.isPending}>Сохранить</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
