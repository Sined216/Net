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
        <ScrollArea.Autosize mah={540} type="hover" offsetScrollbars>
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

            <Field label={`Размер подписи группы — ${value.groupTitleSize} px`}>
              <Slider
                size="sm" min={8} max={20} step={1} value={value.groupTitleSize}
                disabled={value.groupTitle === 'hidden'}
                onChange={(v) => set('groupTitleSize', v)}
                marks={[{ value: 8 }, { value: 12 }, { value: 20 }]}
              />
            </Field>

            <Divider my={4} />
            <Section title="Узлы устройств" />
            <Text size="xs" c="dimmed">
              Строки под названием: включённые идут сверху вниз в этом порядке, карточка растёт и сжимается сама.
            </Text>
            <Switch
              size="xs" label="Код устройства" checked={value.deviceSubtitle}
              onChange={(e) => set('deviceSubtitle', e.currentTarget.checked)}
            />
            <Switch
              size="xs" label="IP управления" checked={value.deviceIp}
              onChange={(e) => set('deviceIp', e.currentTarget.checked)}
            />
            <Switch
              size="xs" label="Название модели" checked={value.deviceTemplate}
              onChange={(e) => set('deviceTemplate', e.currentTarget.checked)}
            />
            <Switch
              size="xs" label="Фирма-изготовитель" checked={value.deviceManufacturer}
              onChange={(e) => set('deviceManufacturer', e.currentTarget.checked)}
            />
            <Switch
              size="xs" label="Счётчик портов" checked={value.devicePorts}
              onChange={(e) => set('devicePorts', e.currentTarget.checked)}
            />

            <Field label={`Название — ${value.deviceTitleSize} px`}>
              <Slider
                size="sm" min={9} max={24} step={1} value={value.deviceTitleSize}
                onChange={(v) => set('deviceTitleSize', v)}
                marks={[{ value: 9 }, { value: 14 }, { value: 24 }]}
              />
            </Field>
            <Field label={`Жирность названия — ${value.deviceTitleWeight}`}>
              <Slider
                size="sm" min={300} max={800} step={100} value={value.deviceTitleWeight}
                onChange={(v) => set('deviceTitleWeight', v)}
                marks={[{ value: 300 }, { value: 500 }, { value: 700 }]}
              />
            </Field>
            <Field label={`Строки под названием — ${value.deviceLineSize} px`}>
              <Slider
                size="sm" min={8} max={18} step={1} value={value.deviceLineSize}
                onChange={(v) => set('deviceLineSize', v)}
                marks={[{ value: 8 }, { value: 12 }, { value: 18 }]}
              />
            </Field>
            <Field label={`Жирность строк — ${value.deviceLineWeight}`}>
              <Slider
                size="sm" min={300} max={700} step={100} value={value.deviceLineWeight}
                onChange={(v) => set('deviceLineWeight', v)}
                marks={[{ value: 300 }, { value: 400 }, { value: 700 }]}
              />
            </Field>
            <Switch
              size="xs" label="Свечение по цвету модели" checked={value.deviceGlow}
              onChange={(e) => set('deviceGlow', e.currentTarget.checked)}
            />
            <Switch
              size="xs" label="Тёмная карточка узла" checked={value.deviceDark}
              onChange={(e) => set('deviceDark', e.currentTarget.checked)}
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
            <Field label="Подписи портов на концах линии">
              <SegmentedControl
                size="xs" fullWidth value={value.edgeLabels}
                onChange={(v) => set('edgeLabels', v as TopologyAppearance['edgeLabels'])}
                data={[
                  { value: 'always', label: 'Всегда' },
                  { value: 'hover', label: 'При наведении' },
                  { value: 'never', label: 'Скрыть' },
                ]}
              />
            </Field>
            <Switch
              size="xs" label="Название порта рядом с номером" checked={value.edgeLabelName}
              disabled={value.edgeLabels === 'never'}
              onChange={(e) => set('edgeLabelName', e.currentTarget.checked)}
            />
            <Field label={`Размер подписи порта — ${value.edgeLabelSize} px`}>
              <Slider
                size="sm" min={7} max={16} step={1} value={value.edgeLabelSize}
                disabled={value.edgeLabels === 'never'}
                onChange={(v) => set('edgeLabelSize', v)}
                marks={[{ value: 7 }, { value: 10 }, { value: 16 }]}
              />
            </Field>

            <Divider my={4} />
            <Section title="Автоматическая раскладка" />
            <Text size="xs" c="dimmed">
              Действуют при нажатии «Разложить»: узлы, расставленные руками, эти настройки не двигают.
            </Text>
            <Field label="Алгоритм">
              <SegmentedControl
                size="xs" fullWidth value={value.layoutAlgorithm}
                onChange={(v) => set('layoutAlgorithm', v as TopologyAppearance['layoutAlgorithm'])}
                data={[
                  { value: 'layered', label: 'Слоями' },
                  { value: 'mrtree', label: 'Деревом' },
                  { value: 'force', label: 'Силой' },
                  { value: 'stress', label: 'Кластером' },
                ]}
              />
            </Field>
            <Text size="xs" c="dimmed">
              «Слоями» — ряды сверху вниз или слева направо, как сеть рисуют от руки. «Деревом» — от корня
              веером. «Силой» и «Кластером» — органическая раскладка без выраженных рядов, ближе к тому, как
              узлы расталкивались раньше, но с учётом рамок групп.
            </Text>
            <Field label={`Между рядами — ${value.layoutRowGap} px`}>
              <Slider
                size="sm" min={60} max={260} step={10} value={value.layoutRowGap}
                onChange={(v) => set('layoutRowGap', v)}
                marks={[{ value: 60 }, { value: 120 }, { value: 260 }]}
              />
            </Field>
            <Field label={`Между узлами в ряду — ${value.layoutNodeGap} px`}>
              <Slider
                size="sm" min={16} max={140} step={4} value={value.layoutNodeGap}
                onChange={(v) => set('layoutNodeGap', v)}
                marks={[{ value: 16 }, { value: 44 }, { value: 140 }]}
              />
            </Field>

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
