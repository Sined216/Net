import { useEffect, useState } from 'react';
import {
  ActionIcon, Alert, Button, Checkbox, Group, Modal, Stack, Table, Text, TextInput, Textarea,
  Title, Tooltip,
} from '@mantine/core';
import { IconPencil, IconPlus, IconTrash, IconUsers } from '@tabler/icons-react';
import {
  useCreateSite, useDeleteSite, useSetSiteAccess, useSiteAccess, useSites, useUpdateSite, useUsers,
} from '../api/hooks';
import { notifyError, notifySuccess } from '../lib/notify';
import type { SiteOut } from '../api/types';

/** Площадки — фабрики, сети которых не пересекаются.
 *
 * Заводит и раздаёт их только администратор: это не рабочая настройка, а
 * разделение системы. Всё остальное приложение работает внутри одной
 * выбранной площадки — её выбирают в шапке.
 */
export function SitesPage() {
  const { data: sites = [], isLoading, error } = useSites();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SiteOut | null>(null);
  const [sharing, setSharing] = useState<SiteOut | null>(null);
  const remove = useDeleteSite();

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Площадки</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
          Площадка
        </Button>
      </Group>

      <Text c="dimmed" size="sm">
        Сети площадок не пересекаются: устройства, кабели, теги, VLAN и группы принадлежат ровно одной, и
        кабель между площадками не запишется даже при ошибке в программе — это запрещено самой базой. Общими
        остаются модели техники, пресеты кабелей и справочники разъёмов: заводить «Cisco Catalyst 2960» заново
        на каждой фабрике незачем. Коды устройств сквозные — SW-0042 один на всю систему.
      </Text>

      {error && <Alert color="red">{(error as Error).message}</Alert>}

      <Table withTableBorder verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Название</Table.Th>
            <Table.Th>Заметки</Table.Th>
            <Table.Th w={140} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sites.map((site) => (
            <Table.Tr key={site.id}>
              <Table.Td><Text fw={500}>{site.name}</Text></Table.Td>
              <Table.Td><Text size="sm" c="dimmed">{site.notes || '—'}</Text></Table.Td>
              <Table.Td>
                <Group gap={2} justify="flex-end" wrap="nowrap">
                  <Tooltip label="Кому доступна">
                    <ActionIcon variant="subtle" size="sm" onClick={() => setSharing(site)}>
                      <IconUsers size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Переименовать">
                    <ActionIcon variant="subtle" size="sm" onClick={() => setEditing(site)}>
                      <IconPencil size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Удалить — только пустую">
                    <ActionIcon
                      variant="subtle" size="sm" color="red"
                      onClick={() => {
                        if (!confirm(`Удалить площадку «${site.name}»? Вместе с ней исчезнут её теги, VLAN и группы.`)) return;
                        remove.mutate(site.id, {
                          onSuccess: () => notifySuccess('Площадка удалена'), onError: notifyError,
                        });
                      }}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {sites.length === 0 && <Text c="dimmed">{isLoading ? 'Загрузка…' : 'Площадок пока нет'}</Text>}

      {(creating || editing) && (
        <SiteFormModal site={editing} onClose={() => { setCreating(false); setEditing(null); }} />
      )}
      {sharing && <SiteAccessModal site={sharing} onClose={() => setSharing(null)} />}
    </Stack>
  );
}

function SiteFormModal({ site, onClose }: { site: SiteOut | null; onClose: () => void }) {
  const [name, setName] = useState(site?.name ?? '');
  const [notes, setNotes] = useState(site?.notes ?? '');
  const create = useCreateSite();
  const update = useUpdateSite();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const body = { name: name.trim(), notes: notes.trim() || null };
    const done = { onSuccess: () => { notifySuccess('Сохранено'); onClose(); }, onError: notifyError };
    if (site) update.mutate({ id: site.id, body }, done);
    else create.mutate(body, done);
  }

  return (
    <Modal opened onClose={onClose} title={site ? 'Площадка' : 'Новая площадка'} centered>
      <form onSubmit={submit}>
        <Stack>
          <TextInput
            label="Название" required data-autofocus value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="Завод в Подольске"
          />
          <Textarea
            label="Заметки" autosize minRows={2} value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button type="submit" loading={create.isPending || update.isPending}>Сохранить</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** Кому площадка доступна. Администраторов в списке нет: они видят все
 * площадки по роли, и галочка у них ничего не значила бы. */
function SiteAccessModal({ site, onClose }: { site: SiteOut; onClose: () => void }) {
  const { data: users = [] } = useUsers();
  const { data: granted, isLoading } = useSiteAccess(site.id);
  const save = useSetSiteAccess();
  const [selected, setSelected] = useState<number[]>([]);

  useEffect(() => {
    if (granted) setSelected(granted);
  }, [granted]);

  const candidates = users.filter((u) => u.role !== 'admin' && u.is_active);

  return (
    <Modal opened onClose={onClose} title={`Доступ к площадке «${site.name}»`} centered>
      <Stack>
        {isLoading ? <Text c="dimmed">Загрузка…</Text> : (
          <Stack gap="xs">
            {candidates.map((user) => (
              <Checkbox
                key={user.id}
                label={`${user.full_name} (${user.username})`}
                checked={selected.includes(user.id)}
                onChange={(e) => setSelected((prev) => (
                  e.currentTarget.checked ? [...prev, user.id] : prev.filter((id) => id !== user.id)
                ))}
              />
            ))}
            {candidates.length === 0 && (
              <Text c="dimmed" size="sm">
                Кроме администраторов пользователей нет — а им доступны все площадки по роли.
              </Text>
            )}
          </Stack>
        )}
        <Group justify="flex-end">
          <Button
            loading={save.isPending}
            onClick={() => save.mutate({ id: site.id, userIds: selected }, {
              onSuccess: () => { notifySuccess('Доступ сохранён'); onClose(); }, onError: notifyError,
            })}
          >
            Сохранить
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
