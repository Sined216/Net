import { useState } from 'react';
import { ActionIcon, Alert, Button, ColorInput, Group, Modal, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconEdit, IconPlus, IconTrash } from '@tabler/icons-react';
import { useCreateTag, useDeleteTag, useTags, useUpdateTag } from '../api/hooks';
import { flattenTagsOrdered } from '../lib/utils';
import { notifyError, notifySuccess } from '../lib/notify';
import type { TagOut } from '../api/types';
import { useCan } from '../auth/permissions';

export function TagsPage() {
  const canEdit = useCan('edit');
  const { data: tags = [], isLoading, error } = useTags();
  const [editing, setEditing] = useState<TagOut | 'new' | null>(null);
  const deleteTag = useDeleteTag();

  const ordered = flattenTagsOrdered(tags);

  function handleDelete(tag: TagOut) {
    if (!confirm(`Удалить тег «${tag.name}»? Дочерние теги удалятся вместе с ним, у устройств он просто снимется.`)) return;
    deleteTag.mutate(tag.id, { onSuccess: () => notifySuccess('Тег удалён'), onError: notifyError });
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Теги</Title>
        {canEdit && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
            Тег
          </Button>
        )}
      </Group>
      <Text c="dimmed" size="sm">
        Вложенность — только для организации списка (напр. «Завод → Цех 1 → Шкаф А»). Устройство может нести сразу
        несколько тегов; фильтр по тегу ищет точное совпадение, без автоматического захвата дочерних.
      </Text>

      {error && <Alert color="red">{(error as Error).message}</Alert>}

      <Table withTableBorder verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Тег</Table.Th>
            <Table.Th w={120} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {ordered.map(({ tag, depth }) => (
            <Table.Tr key={tag.id}>
              <Table.Td>
                <Text component="span" ff="monospace" c="dimmed">
                  {'—'.repeat(depth)}{' '}
                </Text>
                {tag.color && <span className="tag-badge-dot" style={{ background: tag.color }} />}
                {tag.name}
              </Table.Td>
              <Table.Td>
                <Group gap={4} justify="flex-end">
                  {canEdit && (
                    <>
                      <ActionIcon variant="subtle" onClick={() => setEditing(tag)}>
                        <IconEdit size={16} />
                      </ActionIcon>
                      <ActionIcon variant="subtle" color="red" onClick={() => handleDelete(tag)}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </>
                  )}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
          {!isLoading && ordered.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={2}>
                <Text c="dimmed">Тегов ещё нет</Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      {editing && <TagFormModal tag={editing === 'new' ? null : editing} tags={tags} onClose={() => setEditing(null)} />}
    </Stack>
  );
}

export function TagFormModal({ tag, tags, draftName, onClose }: {
  tag: TagOut | null;
  tags: TagOut[];
  /** Название для нового тега — например взятое из строки файла импорта. */
  draftName?: string;
  onClose: () => void;
}) {
  const isEdit = !!tag;
  const [name, setName] = useState(tag?.name ?? draftName ?? '');
  const [parentId, setParentId] = useState<string | null>(tag?.parent_id ? String(tag.parent_id) : null);
  const [color, setColor] = useState(tag?.color ?? '#94a3b8');
  const createTag = useCreateTag();
  const updateTag = useUpdateTag();

  const descendantIds = isEdit ? collectDescendants(tags, tag!.id) : new Set<number>();
  const parentOptions = flattenTagsOrdered(tags)
    .filter(({ tag: t }) => !isEdit || (t.id !== tag!.id && !descendantIds.has(t.id)))
    .map(({ tag: t, depth }) => ({ value: String(t.id), label: `${'—'.repeat(depth)} ${t.name}` }));

  const pending = createTag.isPending || updateTag.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = { name: name.trim(), parent_id: parentId ? parseInt(parentId, 10) : null, color };
    const onSuccess = () => {
      notifySuccess(isEdit ? 'Тег обновлён' : 'Тег создан');
      onClose();
    };
    if (isEdit) updateTag.mutate({ id: tag!.id, body }, { onSuccess, onError: notifyError });
    else createTag.mutate(body, { onSuccess, onError: notifyError });
  }

  return (
    <Modal opened onClose={onClose} title={isEdit ? `Тег: ${tag!.name}` : 'Новый тег'}>
      <form onSubmit={handleSubmit}>
        <Stack>
          <TextInput label="Название" value={name} onChange={(e) => setName(e.currentTarget.value)} required autoFocus />
          <Select
            label="Родительский тег"
            placeholder="— нет, верхний уровень —"
            data={parentOptions}
            value={parentId}
            onChange={setParentId}
            clearable
          />
          <ColorInput label="Цвет" value={color} onChange={setColor} />
          <Group justify="flex-end" mt="sm">
            <Button type="submit" loading={pending}>
              {isEdit ? 'Сохранить' : 'Создать'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function collectDescendants(tags: TagOut[], rootId: number): Set<number> {
  const children = new Map<number, number[]>();
  for (const t of tags) {
    if (t.parent_id != null) {
      if (!children.has(t.parent_id)) children.set(t.parent_id, []);
      children.get(t.parent_id)!.push(t.id);
    }
  }
  const out = new Set<number>();
  const stack = [...(children.get(rootId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}
