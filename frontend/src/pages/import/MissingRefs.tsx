import { useState } from 'react';
import { ActionIcon, Paper, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { useTags } from '../../api/hooks';
import { GroupEditModal } from '../topology/GroupEditModal';
import { TagFormModal } from '../TagsPage';
import { TemplateFormModal } from '../TemplatesPage';
import type { ImportRowOut } from '../../api/types';

/** Чего из файла нет в справочниках — и кнопки, чтобы это завести.
 *
 * Окно устройства умеет подставить только то, что нашлось по названию: если
 * группы «Цех 2» в базе нет, поле останется пустым, и связь строки с группой
 * молча пропадёт. Заметить это по таблице импорта нельзя — там просто текст
 * из файла. Поэтому недостающие названия собраны сюда: сначала заводятся
 * справочники, и только потом строки переносятся уже с подставленной
 * группой, шаблоном и тегами.
 *
 * «+» открывает обычное окно справочника с подставленным названием — то же
 * самое, что на вкладках «Шаблоны», «Топология» и «Теги». Своей упрощённой
 * формы здесь нет намеренно: у шаблона надо выбрать тип и набрать порты, и
 * делать это в двух разных местах по-разному незачем.
 */
export function MissingRefs({ rows }: { rows: ImportRowOut[] }) {
  const { data: tags = [] } = useTags();
  const [newTemplate, setNewTemplate] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [newTag, setNewTag] = useState<string | null>(null);

  const waiting = rows.filter((r) => r.status === 'new');
  const missingTemplates = distinct(waiting.map((r) => (r.suggested_template_id == null ? r.template_name : null)));
  const missingGroups = distinct(waiting.map((r) => (r.suggested_group_id == null ? r.group_name : null)));
  const knownTags = new Set(tags.map((t) => refKey(t.name)));
  const missingTags = distinct(
    waiting.flatMap((r) => splitTags(r.tags_text)).filter((name) => !knownTags.has(refKey(name))),
  );

  if (!missingTemplates.length && !missingGroups.length && !missingTags.length) return null;

  return (
    <>
      <Paper withBorder p="md" radius="md">
        <Stack gap="md">
          <div>
            <Title order={5}>В файле есть то, чего нет в справочниках</Title>
            <Text size="sm" c="dimmed">
              Такие названия при переносе строки не подставятся, и связь потеряется. Заведите их здесь — подсказки
              в таблице пересчитаются сразу.
            </Text>
          </div>
          <NameTable title="Шаблоны устройств" names={missingTemplates} onAdd={setNewTemplate} />
          <NameTable title="Группы на топологии" names={missingGroups} onAdd={setNewGroup} />
          <NameTable title="Теги" names={missingTags} onAdd={setNewTag} />
        </Stack>
      </Paper>

      {newTemplate != null && (
        <TemplateFormModal template={null} draftName={newTemplate} onClose={() => setNewTemplate(null)} />
      )}
      {newGroup != null && (
        <GroupEditModal group={null} draftName={newGroup} onClose={() => setNewGroup(null)} />
      )}
      {newTag != null && (
        <TagFormModal tag={null} tags={tags} draftName={newTag} onClose={() => setNewTag(null)} />
      )}
    </>
  );
}

/** Названия из файла, которым нет записи в справочнике. */
function NameTable({ title, names, onAdd }: {
  title: string;
  names: string[];
  onAdd: (name: string) => void;
}) {
  if (names.length === 0) return null;
  return (
    <div>
      <Text size="sm" fw={500} mb={6}>{title} ({names.length})</Text>
      {/* Табличка узкая: названия справочников короткие, и растягивать её на
          всю ширину значит увести «+» на другой край экрана. */}
      <Table withTableBorder verticalSpacing={4} horizontalSpacing="sm" maw={520}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Название из файла</Table.Th>
            <Table.Th w={50} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {names.map((name) => (
            <Table.Tr key={name}>
              <Table.Td><Text size="sm">{name}</Text></Table.Td>
              <Table.Td>
                <Tooltip label={`Завести «${name}»`}>
                  <ActionIcon variant="subtle" size="sm" onClick={() => onAdd(name)}>
                    <IconPlus size={16} />
                  </ActionIcon>
                </Tooltip>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </div>
  );
}

/** Названия из файла без пустых и повторов; регистр и лишние пробелы не в
 * счёт — как их не считает и сервер, когда ищет запись справочника. */
function distinct(values: (string | null)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const name = (value ?? '').trim();
    if (!name) continue;
    const key = refKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function refKey(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(' ').toLowerCase();
}

function splitTags(value: string | null): string[] {
  if (!value) return [];
  return value.replace(/;/g, ',').split(',').map((part) => part.trim()).filter(Boolean);
}
