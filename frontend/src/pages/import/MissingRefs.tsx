import { useState } from 'react';
import {
  Badge, Button, Group, NumberInput, Paper, Select, Stack, Table, Text, Title,
} from '@mantine/core';
import {
  useConnectorTypes, useCreateDeviceTemplate, useCreateTag, useCreateTopologyGroup, useDeviceTypes,
  useTags,
} from '../../api/hooks';
import { notifyError, notifySuccess } from '../../lib/notify';
import type { ImportRowOut } from '../../api/types';

/** Чего из файла нет в справочниках — и кнопки, чтобы это завести.
 *
 * Окно устройства умеет подставить только то, что нашлось по названию: если
 * группы «Цех 2» в базе нет, поле останется пустым, и связь строки с группой
 * молча пропадёт. Заметить это по таблице импорта нельзя — там просто текст
 * из файла. Поэтому недостающие названия собраны сюда: сначала заводятся
 * справочники, и только потом строки переносятся уже с подставленной
 * группой, шаблоном и тегами.
 */
export function MissingRefs({ rows }: { rows: ImportRowOut[] }) {
  const { data: tags = [] } = useTags();
  const { data: deviceTypes = [] } = useDeviceTypes();
  const { data: connectors = [] } = useConnectorTypes();
  const createTemplate = useCreateDeviceTemplate();
  const createGroup = useCreateTopologyGroup();
  const createTag = useCreateTag();

  // Что завести у каждого шаблона: тип устройства и сколько портов. Шаблоны
  // разные, общей настройкой тут не обойтись — коммутатор на 24 порта и
  // видеокамера с одним приходят одним файлом.
  const [plan, setPlan] = useState<Record<string, { typeId: string | null; ports: number }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const waiting = rows.filter((r) => r.status === 'new');
  const missingTemplates = distinct(waiting.map((r) => (r.suggested_template_id == null ? r.template_name : null)));
  const missingGroups = distinct(waiting.map((r) => (r.suggested_group_id == null ? r.group_name : null)));
  const knownTags = new Set(tags.map((t) => refKey(t.name)));
  const missingTags = distinct(
    waiting.flatMap((r) => splitTags(r.tags_text)).filter((name) => !knownTags.has(refKey(name))),
  );

  if (!missingTemplates.length && !missingGroups.length && !missingTags.length) return null;

  const defaultTypeId = deviceTypes[0] ? String(deviceTypes[0].id) : null;
  const defaultConnectorId = connectors.find((c) => c.name === 'RJ45')?.id ?? connectors[0]?.id ?? null;
  const planFor = (name: string) => plan[name] ?? { typeId: defaultTypeId, ports: 0 };
  const patchPlan = (name: string, patch: Partial<{ typeId: string | null; ports: number }>) =>
    setPlan((prev) => ({ ...prev, [name]: { ...planFor(name), ...patch } }));

  /** Заводим по очереди, а не пачкой параллельных запросов: так понятно, на
   * каком названии всё сломалось, и повтор не заведёт дубль уже созданного. */
  async function run(mark: string, names: string[], create: (name: string) => Promise<unknown>, done: string) {
    setBusy(mark);
    let added = 0;
    try {
      for (const name of names) {
        await create(name);
        added += 1;
      }
      notifySuccess(`${done}: ${added}`);
    } catch (error) {
      notifyError(error);
      if (added) notifySuccess(`${done}: ${added}`);
    } finally {
      setBusy(null);
    }
  }

  const makeTemplate = (name: string) => {
    const { typeId, ports } = planFor(name);
    if (!typeId) return Promise.reject(new Error('Сначала заведите тип устройства во вкладке «Справочники»'));
    return createTemplate.mutateAsync({
      name,
      device_type_id: parseInt(typeId, 10),
      interfaces: Array.from({ length: ports }, (_, i) => ({
        label: `Порт ${i + 1}`, connector_id: defaultConnectorId,
      })),
    });
  };

  return (
    <Paper withBorder p="md" radius="md" bg="var(--mantine-color-yellow-light)">
      <Stack gap="sm">
        <div>
          <Title order={5}>В файле есть то, чего нет в справочниках</Title>
          <Text size="sm" c="dimmed">
            Такие названия при переносе строки не подставятся, и связь потеряется. Заведите их здесь — подсказки
            в таблице пересчитаются сразу.
          </Text>
        </div>

        {missingTemplates.length > 0 && (
          <div>
            <Group gap={8} mb={6}>
              <Text size="sm" fw={500}>Шаблоны устройств ({missingTemplates.length})</Text>
              <Button
                size="compact-xs" variant="light"
                loading={busy === 'templates'} disabled={busy != null || deviceTypes.length === 0}
                onClick={() => run('templates', missingTemplates, makeTemplate, 'Заведено шаблонов')}
              >
                Завести все
              </Button>
            </Group>
            {deviceTypes.length === 0 ? (
              <Text size="sm" c="red">
                Типов устройств нет — шаблон завести не из чего. Начните со вкладки «Справочники».
              </Text>
            ) : (
              <Table withTableBorder verticalSpacing={4} horizontalSpacing="sm" bg="var(--mantine-color-body)">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Название из файла</Table.Th>
                    <Table.Th w={200}>Тип устройства</Table.Th>
                    <Table.Th w={120}>Портов</Table.Th>
                    <Table.Th w={110} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {missingTemplates.map((name) => (
                    <Table.Tr key={name}>
                      <Table.Td><Text size="sm">{name}</Text></Table.Td>
                      <Table.Td>
                        <Select
                          size="xs" comboboxProps={{ withinPortal: true }}
                          data={deviceTypes.map((t) => ({ value: String(t.id), label: t.name }))}
                          value={planFor(name).typeId}
                          onChange={(value) => patchPlan(name, { typeId: value })}
                        />
                      </Table.Td>
                      <Table.Td>
                        <NumberInput
                          size="xs" min={0} max={512} clampBehavior="strict"
                          value={planFor(name).ports}
                          onChange={(value) => patchPlan(name, { ports: Number(value) || 0 })}
                        />
                      </Table.Td>
                      <Table.Td>
                        <Button
                          size="compact-xs" variant="subtle" disabled={busy != null}
                          onClick={() => run(`tpl:${name}`, [name], makeTemplate, 'Заведено шаблонов')}
                          loading={busy === `tpl:${name}`}
                        >
                          Завести
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
            <Text size="xs" c="dimmed" mt={4}>
              Порты можно оставить нулём и дозаполнить во вкладке «Шаблоны» — но тогда у заведённых по такому
              шаблону устройств портов не будет.
            </Text>
          </div>
        )}

        {missingGroups.length > 0 && (
          <NameList
            title="Группы на топологии"
            names={missingGroups}
            loading={busy === 'groups'}
            disabled={busy != null}
            onCreate={() => run('groups', missingGroups,
              (name) => createGroup.mutateAsync({ name }), 'Заведено групп')}
          />
        )}

        {missingTags.length > 0 && (
          <NameList
            title="Теги"
            names={missingTags}
            loading={busy === 'tags'}
            disabled={busy != null}
            onCreate={() => run('tags', missingTags,
              (name) => createTag.mutateAsync({ name, parent_id: null, color: null }), 'Заведено тегов')}
          />
        )}
      </Stack>
    </Paper>
  );
}

/** Справочник, у записи которого только название: заводится пачкой без настроек. */
function NameList({ title, names, loading, disabled, onCreate }: {
  title: string;
  names: string[];
  loading: boolean;
  disabled: boolean;
  onCreate: () => void;
}) {
  return (
    <div>
      <Group gap={8} mb={6}>
        <Text size="sm" fw={500}>{title} ({names.length})</Text>
        <Button size="compact-xs" variant="light" loading={loading} disabled={disabled} onClick={onCreate}>
          Завести все
        </Button>
      </Group>
      <Group gap={6}>
        {names.map((name) => (
          <Badge key={name} variant="outline" color="gray" size="sm">{name}</Badge>
        ))}
      </Group>
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
