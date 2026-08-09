import {
  Button, Divider, Group, Popover, ScrollArea, SegmentedControl, Slider, Stack, Switch, Text,
} from '@mantine/core';
import { IconPalette, IconRotate } from '@tabler/icons-react';
import { DEFAULT_APPEARANCE, type TopologyAppearance } from './appearance';

interface Props {
  value: TopologyAppearance;
  onChange: (value: TopologyAppearance) => void;
}

/** Настройки внешнего вида схемы.
 *
 * Всё применяется сразу, без кнопки «Применить»: схема видна за окном
 * настроек, и подбирать вид имеет смысл, глядя на неё, а не вслепую.
 */
export function AppearanceMenu({ value, onChange }: Props) {
  const set = <K extends keyof TopologyAppearance>(key: K, next: TopologyAppearance[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <Popover width={330} position="bottom-end" shadow="md" withArrow trapFocus={false}>
      <Popover.Target>
        <Button variant="light" leftSection={<IconPalette size={16} />}>Вид</Button>
      </Popover.Target>
      <Popover.Dropdown p="sm">
        <ScrollArea.Autosize mah={470} type="hover" offsetScrollbars>
          <Stack gap="xs" pr={6}>
            <Section title="Рамки групп" />

            <Field label="Контур">
              <SegmentedControl
                size="xs" fullWidth value={value.groupBorder}
                onChange={(v) => set('groupBorder', v as TopologyAppearance['groupBorder'])}
                data={[
                  { value: 'solid', label: 'Сплошной' },
                  { value: 'dashed', label: 'Пунктир' },
                  { value: 'dotted', label: 'Точки' },
                  { value: 'none', label: 'Нет' },
                ]}
              />
            </Field>

            <Field label={`Толщина контура — ${value.groupBorderWidth} px`}>
              <Slider
                size="sm" min={1} max={4} step={0.5} value={value.groupBorderWidth}
                disabled={value.groupBorder === 'none'}
                onChange={(v) => set('groupBorderWidth', v)}
                marks={[{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }]}
              />
            </Field>

            <Field label={`Скругление — ${value.groupRadius} px`}>
              <Slider
                size="sm" min={0} max={24} step={2} value={value.groupRadius}
                onChange={(v) => set('groupRadius', v)}
                marks={[{ value: 0 }, { value: 12 }, { value: 24 }]}
              />
            </Field>

            <Field label={`Заливка — ${value.groupFill}%`}>
              <Slider
                size="sm" min={0} max={25} step={1} value={value.groupFill}
                onChange={(v) => set('groupFill', v)}
                marks={[{ value: 0 }, { value: 6 }, { value: 25 }]}
              />
            </Field>

            <Field label="Подпись группы">
              <SegmentedControl
                size="xs" fullWidth value={value.groupTitle}
                onChange={(v) => set('groupTitle', v as TopologyAppearance['groupTitle'])}
                data={[
                  { value: 'onFrame', label: 'Врезкой' },
                  { value: 'inside', label: 'Внутри' },
                  { value: 'hidden', label: 'Скрыть' },
                ]}
              />
            </Field>

            <Switch
              size="xs" label="Число устройств рядом с названием" checked={value.groupCount}
              disabled={value.groupTitle === 'hidden'}
              onChange={(e) => set('groupCount', e.currentTarget.checked)}
            />

            <Divider my={4} />
            <Section title="Узлы устройств" />
            <Switch
              size="xs" label="Название под кодом" checked={value.deviceSubtitle}
              onChange={(e) => set('deviceSubtitle', e.currentTarget.checked)}
            />
            <Switch
              size="xs" label="Счётчик портов" checked={value.devicePorts}
              onChange={(e) => set('devicePorts', e.currentTarget.checked)}
            />
            <Switch
              size="xs" label="Свечение по цвету модели" checked={value.deviceGlow}
              onChange={(e) => set('deviceGlow', e.currentTarget.checked)}
            />

            <Divider my={4} />
            <Section title="Связи" />
            <Field label={`Толщина линии — ${value.edgeWidth} px`}>
              <Slider
                size="sm" min={1} max={5} step={0.5} value={value.edgeWidth}
                onChange={(v) => set('edgeWidth', v)}
                marks={[{ value: 1 }, { value: 3 }, { value: 5 }]}
              />
            </Field>
            <Switch
              size="xs" label="Подписи портов на концах линии" checked={value.edgeLabels}
              onChange={(e) => set('edgeLabels', e.currentTarget.checked)}
            />

            <Divider my={4} />
            <Section title="Полотно" />
            <Field label="Фон">
              <SegmentedControl
                size="xs" fullWidth value={value.background}
                onChange={(v) => set('background', v as TopologyAppearance['background'])}
                data={[
                  { value: 'dots', label: 'Точки' },
                  { value: 'lines', label: 'Сетка' },
                  { value: 'cross', label: 'Кресты' },
                  { value: 'none', label: 'Пусто' },
                ]}
              />
            </Field>
            <Switch
              size="xs" label="Мини-карта" checked={value.minimap}
              onChange={(e) => set('minimap', e.currentTarget.checked)}
            />

            <Divider my={4} />
            <Group justify="space-between" align="center">
              <Text size="xs" c="dimmed">Настройки личные, хранятся в браузере</Text>
              <Button
                size="compact-xs" variant="subtle" leftSection={<IconRotate size={14} />}
                onClick={() => onChange(DEFAULT_APPEARANCE)}
              >
                Сбросить
              </Button>
            </Group>
          </Stack>
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
}

function Section({ title }: { title: string }) {
  return <Text size="xs" fw={700} tt="uppercase" c="dimmed">{title}</Text>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack gap={2}>
      <Text size="xs">{label}</Text>
      {children}
    </Stack>
  );
}
