import { useEffect, useState } from 'react';
import {
  Alert, Badge, Button, ColorInput, Group, Modal, Select,
  Stack, Table, Text, TextInput, Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconFilterOff, IconPlus } from '@tabler/icons-react';
import { DeleteAction, EditAction } from '../components/RowAction';
import {
  useCreateLinkTemplate, useDeleteLink, useDeleteLinkTemplate,
  useLinkTemplates, useLinks, useUpdateLinkTemplate,
} from '../api/hooks';
import { nn } from '../lib/utils';
import { notifyError, notifySuccess } from '../lib/notify';
import { confirmAction } from '../lib/confirm';
import { linkSourceLabel, lineStyleLabel, mediaTypeLabel } from '../lib/enumLabels';
import { LinkFormModal } from './links/LinkFormModal';
import type { LinkOut, LinkTemplateOut, MediaType, LineStyle } from '../api/types';
import { useCan } from '../auth/permissions';

const MEDIA_TYPES: { value: MediaType; label: string }[] = (['copper', 'fiber', 'wireless', 'dac', 'other'] as const)
  .map((value) => ({ value, label: mediaTypeLabel(value) }));
const LINE_STYLES: { value: LineStyle; label: string }[] = (['solid', 'dashed', 'dotted'] as const)
  .map((value) => ({ value, label: lineStyleLabel(value) }));
const PAGE = 100;

export function LinksPage() {
  const { data: linkTemplates = [] } = useLinkTemplates();
  // Концы приходят уже с подписями: раньше страница везла все устройства со
  // всеми портами только ради того, чтобы вместо номера порта показать «Gi0/2».
  const [shown, setShown] = useState(PAGE);
  /** Отбор кабелей. Считает его база — как и на списке устройств: кабелей
   * на тысяче железок около десяти тысяч, и найти среди них тот, что идёт
   * от SW-0003, нажимая «показать ещё», нельзя. */
  const [deviceFilter, setDeviceFilter] = useState('');
  const [danglingOnly, setDanglingOnly] = useState<string | null>(null);
  const [debouncedDevice] = useDebouncedValue(deviceFilter, 300);
  // Сменили условия — показываем список сначала, иначе «показать ещё»
  // продолжало бы уже несуществующий.
  useEffect(() => setShown(PAGE), [debouncedDevice, danglingOnly]);
  const { data: linkPage, error: linksError } = useLinks({
    device: debouncedDevice.trim() || undefined,
    dangling: danglingOnly == null ? undefined : danglingOnly === 'yes',
    limit: shown,
  });
  const filtered = deviceFilter.trim().length > 0 || danglingOnly != null;
  const links = linkPage?.items ?? [];
  const total = linkPage?.total ?? 0;
  const [ltModalOpen, setLtModalOpen] = useState(false);
  const [editingLt, setEditingLt] = useState<LinkTemplateOut | null>(null);
  const [editingLink, setEditingLink] = useState<LinkOut | null>(null);
  const deleteLt = useDeleteLinkTemplate();
  const deleteLink = useDeleteLink();
  const canEdit = useCan('edit');
  // Шаблон связи — справочник общий для всех площадок, удалять его вправе
  // только admin (см. тот же довод на сервере, routers/link_templates.py).
  // Сами связи между конкретными портами остаются на canEdit — они не общие.
  const canAdmin = useCan('admin');

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
      <Table.ScrollContainer minWidth={620}>
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
                <Table.Td>{mediaTypeLabel(t.media_type)}</Table.Td>
                <Table.Td>{t.cable_category || '—'}</Table.Td>
                <Table.Td><span className="tag-badge-dot" style={{ background: t.color }} />{t.color}</Table.Td>
                <Table.Td>{lineStyleLabel(t.line_style)}</Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {canEdit && (
                      <EditAction label={`Изменить шаблон связи «${t.name}»`} onClick={() => setEditingLt(t)} />
                    )}
                    {canAdmin && (
                      <DeleteAction
                        label={`Удалить шаблон связи «${t.name}»`}
                        onClick={async () => {
                          if (!(await confirmAction('Удалить шаблон связи? У существующих связей с этим шаблоном он просто снимется, сами связи останутся.'))) return;
                          deleteLt.mutate(t.id, { onSuccess: () => notifySuccess('Шаблон связи удалён'), onError: notifyError });
                        }}
                      />
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
      </Table.ScrollContainer>

      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Title order={2}>Связи между портами</Title>
          <Text c="dimmed">{total}</Text>
        </Group>
        {filtered && (
          <Button
            variant="subtle" leftSection={<IconFilterOff size={16} />}
            onClick={() => { setDeviceFilter(''); setDanglingOnly(null); }}
          >
            Сбросить отбор
          </Button>
        )}
      </Group>
      <Text c="dimmed" size="sm">
        Новую связь создавайте перетаскиванием на схеме или прямо у порта устройства — здесь можно назначить
        шаблон, уточнить длину/разъём или удалить связь. «Подвешен» означает, что порт на этом конце удалили
        (например сняли сетевую карту), а кабель остался: подключить его заново можно у любого свободного порта.
      </Text>

      {linksError && <Alert color="red">{(linksError as Error).message}</Alert>}

      <Table.ScrollContainer minWidth={1050}>
        <Table withTableBorder verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Устройство A</Table.Th><Table.Th>Порт A</Table.Th>
              <Table.Th>Устройство B</Table.Th><Table.Th>Порт B</Table.Th>
              <Table.Th>Шаблон</Table.Th><Table.Th>Разъём</Table.Th><Table.Th>Длина, м</Table.Th>
              <Table.Th>Источник</Table.Th><Table.Th>Состояние</Table.Th><Table.Th w={80} />
            </Table.Tr>
            {/* Поля отбора под заголовками — там же, где их ищут на списке
                устройств. Отбор по железке общий на оба конца: кабель ищут
                по тому, что на нём висит, а не по тому, какой конец записан
                стороной A. */}
            <Table.Tr>
              <Table.Th colSpan={4}>
                <TextInput
                  size="xs" placeholder="код или название железки на любом конце"
                  aria-label="Отбор по устройству"
                  value={deviceFilter} onChange={(e) => setDeviceFilter(e.currentTarget.value)}
                />
              </Table.Th>
              <Table.Th colSpan={4} />
              <Table.Th>
                <Select
                  size="xs" placeholder="все" clearable
                  aria-label="Отбор по состоянию"
                  data={[{ value: 'yes', label: 'подвешен' }, { value: 'no', label: 'оба конца на месте' }]}
                  value={danglingOnly} onChange={setDanglingOnly}
                />
              </Table.Th>
              <Table.Th />
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
                {/* Код и название вместе: код опознают по наклейке на
                    корпусе, а глазами ищут «станок 1.2.3». Раньше в колонке
                    стоял один код, и понять, что за железка SW-0009, можно
                    было только уйдя на её страницу. */}
                <Table.Td>{a ? <EndDevice code={a.device_code} name={a.device_name} /> : <DanglingEnd />}</Table.Td>
                <Table.Td>{a ? `№${a.port_number} · ${a.interface_label}` : '—'}</Table.Td>
                <Table.Td>{b ? <EndDevice code={b.device_code} name={b.device_name} /> : <DanglingEnd />}</Table.Td>
                <Table.Td>{b ? `№${b.port_number} · ${b.interface_label}` : '—'}</Table.Td>
                <Table.Td>
                  {lt ? (<><span className="tag-badge-dot" style={{ background: lt.color }} />{lt.name}</>) : <Text c="dimmed">— без шаблона —</Text>}
                </Table.Td>
                <Table.Td>{l.connector_type || '—'}</Table.Td>
                <Table.Td>{l.length_m ?? '—'}</Table.Td>
                <Table.Td>{linkSourceLabel(l.source)}</Table.Td>
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
                        <EditAction
                          label={`Изменить связь ${a?.device_code ?? '—'} — ${b?.device_code ?? '—'}`}
                          onClick={() => setEditingLink(l)}
                        />
                        <DeleteAction
                          label={`Удалить связь ${a?.device_code ?? '—'} — ${b?.device_code ?? '—'}`}
                          onClick={async () => {
                            if (!(await confirmAction('Удалить связь? Оба порта снова станут свободными.'))) return;
                            deleteLink.mutate(l.id, { onSuccess: () => notifySuccess('Связь удалена'), onError: notifyError });
                          }}
                        />
                      </>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            );
          })}
          {links.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={10}>
                <Text c="dimmed">{filtered ? 'Под условия отбора ничего не подошло' : 'Связей ещё нет'}</Text>
              </Table.Td>
            </Table.Tr>
          )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
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

/** Железка на конце кабеля: код сверху, название под ним. */
function EndDevice({ code, name }: { code: string; name?: string | null }) {
  return (
    <>
      {code}
      {name && <Text c="dimmed" size="xs">{name}</Text>}
    </>
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
    // Номер правки — тот, что видели при открытии формы: см. app/versioning.py.
    if (isEdit) updateLt.mutate({ id: template!.id, body: { ...body, version: template!.version } }, { onSuccess, onError: notifyError });
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
