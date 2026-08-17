import { useState } from 'react';
import {
  ActionIcon, Badge, Button, ColorInput, Group, Modal, Select,
  Stack, Table, Text, TextInput, Title,
} from '@mantine/core';
import { IconEdit, IconPlus, IconTrash } from '@tabler/icons-react';
import {
  useCreateLinkTemplate, useDeleteLink, useDeleteLinkTemplate,
  useLinkTemplates, useLinks, useUpdateLinkTemplate,
} from '../api/hooks';
import { nn } from '../lib/utils';
import { notifyError, notifySuccess } from '../lib/notify';
import { LinkFormModal } from './links/LinkFormModal';
import type { LinkOut, LinkTemplateOut, MediaType, LineStyle } from '../api/types';
import { useCan } from '../auth/permissions';

const MEDIA_TYPES: MediaType[] = ['copper', 'fiber', 'wireless', 'dac', 'other'];
const LINE_STYLES: LineStyle[] = ['solid', 'dashed', 'dotted'];
const PAGE = 100;

export function LinksPage() {
  const { data: linkTemplates = [] } = useLinkTemplates();
  // Концы приходят уже с подписями: раньше страница везла все устройства со
  // всеми портами только ради того, чтобы вместо номера порта показать «Gi0/2».
  const [shown, setShown] = useState(PAGE);
  const { data: linkPage } = useLinks({ limit: shown });
  const links = linkPage?.items ?? [];
  const total = linkPage?.total ?? 0;
  const [ltModalOpen, setLtModalOpen] = useState(false);
  const [editingLt, setEditingLt] = useState<LinkTemplateOut | null>(null);
  const [editingLink, setEditingLink] = useState<LinkOut | null>(null);
  const deleteLt = useDeleteLinkTemplate();
  const deleteLink = useDeleteLink();
  const canEdit = useCan('edit');

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Шаблоны связей</Title>
        {canEdit && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setLtModalOpen(true)}>
            Шаблон связи
          </Button>
        )}
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
                  {canEdit && (
                    <>
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
                    </>
                  )}
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
            <Table.Th>Источник</Table.Th><Table.Th>Состояние</Table.Th><Table.Th w={80} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {links.map((l) => {
            // Конец может пустовать: порт удалили (сняли сетевую карту), а
            // кабель остался проложен.
            const a = l.end_a ?? undefined;
            const b = l.end_b ?? undefined;
            const dangling = l.interface_a_id == null || l.interface_b_id == null;
            const lt = l.template_id ? linkTemplates.find((t) => t.id === l.template_id) : null;
            return (
              <Table.Tr key={l.id}>
                <Table.Td>{a?.device_code ?? <DanglingEnd />}</Table.Td>
                <Table.Td>{a ? `№${a.port_number} · ${a.interface_label}` : '—'}</Table.Td>
                <Table.Td>{b?.device_code ?? <DanglingEnd />}</Table.Td>
                <Table.Td>{b ? `№${b.port_number} · ${b.interface_label}` : '—'}</Table.Td>
                <Table.Td>
                  {lt ? (<><span className="tag-badge-dot" style={{ background: lt.color }} />{lt.name}</>) : <Text c="dimmed">— без шаблона —</Text>}
                </Table.Td>
                <Table.Td>{l.connector_type || '—'}</Table.Td>
                <Table.Td>{l.length_m ?? '—'}</Table.Td>
                <Table.Td>{l.source}</Table.Td>
                <Table.Td>
                  {/* Подвешенный конец — единственное состояние кабеля,
                      которое видно снаружи и требует действия. Признак
                      «подтверждена» отсюда убран: пока опроса сети нет, все
                      связи заведены руками и подтверждены, и колонка,
                      всегда показывающая одно и то же, только занимала место
                      и просила объяснений. Поле в базе осталось — см. этап 4. */}
                  {dangling ? <Badge color="orange" variant="light">подвешен</Badge> : '—'}
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {canEdit && (
                      <>
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
                      </>
                    )}
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
      {links.length < total && (
        <Group justify="center">
          <Button variant="default" onClick={() => setShown((n) => n + PAGE)}>
            Показать ещё ({total - links.length})
          </Button>
        </Group>
      )}

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
