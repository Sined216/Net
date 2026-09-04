import {
  Button, Chip, Divider, Drawer, Group, NumberInput, SegmentedControl, Select, Slider, Stack,
  Switch, Text,
} from '@mantine/core';
import { IconRotate } from '@tabler/icons-react';
import { DEFAULT_APPEARANCE, type LinkSide, type TopologyAppearance } from './appearance';

/** Разводка кабелей и начертание линии — всё, что даёт роутер JointJS.
 *
 * Панель сбоку, а не окно посреди экрана, и это не вкусовщина. Ручки здесь
 * крутят десятками раз подряд, глядя на схему: на редкой сети и на плотном
 * цехе выигрывают разные значения, и угадать их за человека нельзя. Окно
 * закрывало собой ровно то, что настраивается, — подвинул ползунок и не
 * видишь результата, пока не закроешь. Поэтому `Drawer` без затемнения и
 * без перехвата щелчков: схема слева остаётся видимой и живой, каждый шаг
 * ползунка перерисовывает её на глазах.
 */

/** Поля, которые сбрасывает кнопка внизу. Перечислены явно: сбрасывать весь
 * вид целиком человек не просил — он пришёл за разводкой. */
const ROUTING_KEYS = [
  'edgeRouter', 'routerStep', 'routerPadding', 'routerLaneSpread', 'routerMaxTurn',
  'routerStartSides', 'routerEndSides', 'routerFramesAreObstacles',
  'routerMaxLoops', 'edgeConnector', 'connectorRadius', 'jumpSize', 'jumpKind', 'cornerType',
  'curveDirection', 'curveTension', 'anchorMode', 'anchorPadding', 'connectionPoint',
] as const satisfies readonly (keyof TopologyAppearance)[];

/** Открыта ли панель — своим ключом, отдельно от настроек вида: это
 * состояние экрана, а не оформление схемы. Запись в приватном режиме
 * браузера запрещена, поэтому обе стороны молча переживают отказ. */
const OPEN_KEY = 'netdoc.topology.routingOpen';

export function loadRoutingOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveRoutingOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // Приватный режим — панель просто не переживёт перезагрузку.
  }
}

const SIDES: { value: LinkSide; label: string }[] = [
  { value: 'top', label: 'Сверху' },
  { value: 'right', label: 'Справа' },
  { value: 'bottom', label: 'Снизу' },
  { value: 'left', label: 'Слева' },
];

export function LinkRoutingPanel({ value, onChange, onClose }: {
  value: TopologyAppearance;
  onChange: (next: TopologyAppearance) => void;
  onClose: () => void;
}) {
  const set = <K extends keyof TopologyAppearance>(key: K, next: TopologyAppearance[K]) =>
    onChange({ ...value, [key]: next });

  const reset = () => {
    const next = { ...value };
    for (const key of ROUTING_KEYS) (next as Record<string, unknown>)[key] = DEFAULT_APPEARANCE[key];
    onChange(next);
  };

  const routes = value.edgeRouter === 'metro';

  return (
    <Drawer
      opened onClose={onClose} position="right" size={360} title="Разводка и линии"
      // Полотно видно и остаётся рабочим: затемнение сняли, прокрутку не
      // блокируем, щелчок мимо панели её не закрывает — по схеме в это время
      // как раз и щёлкают.
      withOverlay={false}
      lockScroll={false}
      closeOnClickOutside={false}
    >
      <Stack gap="xs" pb="md">
        <Text size="xs" c="dimmed">
          Всё применяется сразу — схема видна за окном, и подбирать значения имеет смысл, глядя на неё.
          Настройки личные и хранятся в браузере.
        </Text>

        <Section title="Разводка" />
        <Field label="Как ведётся кабель">
          <SegmentedControl
            size="xs" fullWidth value={value.edgeRouter}
            onChange={(v) => set('edgeRouter', v as TopologyAppearance['edgeRouter'])}
            data={[
              { value: 'normal', label: 'Прямая' },
              { value: 'metro', label: 'В обход карточек' },
            ]}
          />
        </Field>
        <Text size="xs" c="dimmed">
          «Прямая» — отрезок между карточками, ничего не обходит. «В обход» ведёт кабель ломаной, огибая
          чужие карточки: чем плотнее схема, тем нужнее.
        </Text>

        <Field label="Форма кабеля">
          <SegmentedControl
            size="xs" fullWidth value={String(value.routerMaxTurn)} disabled={!routes}
            onChange={(v) => set('routerMaxTurn', Number(v) as TopologyAppearance['routerMaxTurn'])}
            data={[
              { value: '90', label: 'Прямые углы' },
              { value: '45', label: 'С диагоналями' },
            ]}
          />
        </Field>
        <Text size="xs" c="dimmed">
          «Прямые углы» — кабель идёт только по горизонтали и вертикали, как на схемах от руки.
          «С диагоналями» разрешает косые куски: путь короче, но картинка беспокойнее.
        </Text>

        <Field label={`Отступ от карточек — ${value.routerPadding} px`}>
          <Slider
            size="sm" min={2} max={60} step={2} value={value.routerPadding} disabled={!routes}
            onChange={(v) => set('routerPadding', v)}
            marks={[{ value: 2 }, { value: 10 }, { value: 30 }, { value: 60 }]}
          />
        </Field>
        <Text size="xs" c="dimmed">
          Насколько раздувается карточка перед поиском пути. Слишком много — проход между двумя близкими
          карточками закрывается совсем, и кабель уходит в обход через всю схему.
        </Text>

        <Field label={`Разнос параллельных кабелей — ${value.routerLaneSpread} px`}>
          <Slider
            size="sm" min={0} max={24} step={2} value={value.routerLaneSpread} disabled={!routes}
            onChange={(v) => set('routerLaneSpread', v)}
            marks={[{ value: 0 }, { value: 6 }, { value: 24 }]}
          />
        </Field>
        <Field label={`Шаг поиска пути — ${value.routerStep} px`}>
          <Slider
            size="sm" min={4} max={40} step={2} value={value.routerStep} disabled={!routes}
            onChange={(v) => set('routerStep', v)}
            marks={[{ value: 4 }, { value: 16 }, { value: 40 }]}
          />
        </Field>

        <Field label="Откуда кабелю выходить">
          <Chip.Group
            multiple value={value.routerStartSides}
            onChange={(v) => set('routerStartSides', v as LinkSide[])}
          >
            <Group gap={6}>
              {SIDES.map((s) => (
                <Chip key={s.value} value={s.value} size="xs" disabled={!routes}>{s.label}</Chip>
              ))}
            </Group>
          </Chip.Group>
        </Field>
        <Field label="Куда входить">
          <Chip.Group
            multiple value={value.routerEndSides}
            onChange={(v) => set('routerEndSides', v as LinkSide[])}
          >
            <Group gap={6}>
              {SIDES.map((s) => (
                <Chip key={s.value} value={s.value} size="xs" disabled={!routes}>{s.label}</Chip>
              ))}
            </Group>
          </Chip.Group>
        </Field>
        <Text size="xs" c="dimmed">
          Ничего не выбрано — разрешены все четыре стороны.
        </Text>

        <Switch
          size="xs" label="Рамки групп — препятствия" checked={value.routerFramesAreObstacles}
          disabled={!routes} onChange={(e) => set('routerFramesAreObstacles', e.currentTarget.checked)}
        />
        <Text size="xs" c="dimmed">
          По умолчанию выключено: рамка обозначает область, а не стену, и обход по её контуру уводит кабель
          вокруг соседних шкафов.
        </Text>
        <Field label="Предел перебора при поиске пути">
          <NumberInput
            size="xs" min={100} max={20000} step={100} value={value.routerMaxLoops} disabled={!routes}
            onChange={(v) => set('routerMaxLoops', typeof v === 'number' ? v : DEFAULT_APPEARANCE.routerMaxLoops)}
            description="Не нашёл за столько шагов — отдаёт запасной путь, не разбирая препятствий"
          />
        </Field>

        <Divider my={4} />
        <Section title="Стиль линии" />
        {/* Список, а не переключатель в строку: шесть подписей в полосу панели
            не влезают и режутся на середине слова. */}
        <Select
          size="xs" label="Начертание" allowDeselect={false} comboboxProps={{ withinPortal: false }}
          value={value.edgeConnector}
          onChange={(v) => v && set('edgeConnector', v as TopologyAppearance['edgeConnector'])}
          data={[
            { value: 'normal', label: 'Острые углы' },
            { value: 'rounded', label: 'Скруглить углы' },
            { value: 'smooth', label: 'Плавная кривая' },
            { value: 'curve', label: 'Дуга' },
            { value: 'straight', label: 'Отрезки с обработкой угла' },
            { value: 'jumpover', label: 'Мостики на пересечениях' },
          ]}
        />

        {(value.edgeConnector === 'rounded' || value.edgeConnector === 'straight') && (
          <Field label={`Радиус скругления — ${value.connectorRadius} px`}>
            <Slider
              size="sm" min={0} max={40} step={2} value={value.connectorRadius}
              onChange={(v) => set('connectorRadius', v)}
              marks={[{ value: 0 }, { value: 8 }, { value: 40 }]}
            />
          </Field>
        )}
        {value.edgeConnector === 'straight' && (
          <Field label="Что делать с углом">
            <SegmentedControl
              size="xs" fullWidth value={value.cornerType}
              onChange={(v) => set('cornerType', v as TopologyAppearance['cornerType'])}
              data={[
                { value: 'point', label: 'Острый' },
                { value: 'cubic', label: 'Скруглить' },
                { value: 'line', label: 'Срезать' },
                { value: 'gap', label: 'Разрыв' },
              ]}
            />
          </Field>
        )}
        {value.edgeConnector === 'jumpover' && (
          <>
            <Field label={`Размер мостика — ${value.jumpSize} px`}>
              <Slider
                size="sm" min={2} max={20} step={1} value={value.jumpSize}
                onChange={(v) => set('jumpSize', v)}
                marks={[{ value: 2 }, { value: 5 }, { value: 20 }]}
              />
            </Field>
            <Field label="Вид мостика">
              <SegmentedControl
                size="xs" fullWidth value={value.jumpKind}
                onChange={(v) => set('jumpKind', v as TopologyAppearance['jumpKind'])}
                data={[
                  { value: 'arc', label: 'Дужка' },
                  { value: 'gap', label: 'Разрыв' },
                  { value: 'cubic', label: 'Волна' },
                ]}
              />
            </Field>
          </>
        )}
        {value.edgeConnector === 'curve' && (
          <>
            <Field label="Направление дуги">
              <SegmentedControl
                size="xs" fullWidth value={value.curveDirection}
                onChange={(v) => set('curveDirection', v as TopologyAppearance['curveDirection'])}
                data={[
                  { value: 'auto', label: 'Само' },
                  { value: 'horizontal', label: 'Вбок' },
                  { value: 'vertical', label: 'Вверх-вниз' },
                  { value: 'outwards', label: 'Наружу' },
                ]}
              />
            </Field>
            <Field label={`Натяжение — ${value.curveTension}`}>
              <Slider
                size="sm" min={0} max={1} step={0.05} value={value.curveTension}
                onChange={(v) => set('curveTension', v)}
                marks={[{ value: 0 }, { value: 0.5 }, { value: 1 }]}
              />
            </Field>
          </>
        )}

        <Divider my={4} />
        <Section title="Крепление к карточке" />
        <Text size="xs" c="dimmed">
          Кабель цепляется к середине стороны, обращённой к другому концу. От этого же выбора роутер берёт
          сторону выхода, поэтому он меняет картинку сильнее, чем кажется.
        </Text>
        <Select
          size="xs" label="Какую сторону выбирать" allowDeselect={false}
          comboboxProps={{ withinPortal: false }} value={value.anchorMode}
          onChange={(v) => v && set('anchorMode', v as TopologyAppearance['anchorMode'])}
          data={[
            { value: 'auto', label: 'Ближайшую к другому концу' },
            { value: 'prefer-vertical', label: 'Верх-низ, бока — если рядом' },
            { value: 'prefer-horizontal', label: 'Бока, верх-низ — если рядом' },
            { value: 'horizontal', label: 'Только бока' },
            { value: 'vertical', label: 'Только верх и низ' },
          ]}
        />
        <Text size="xs" c="dimmed">
          «Ближайшую» библиотека считает по расстоянию со знаком: партнёр ниже на 60 px, но в стороне на
          110 — и ближайшей окажется боковая сторона, кабель выйдет вбок и сразу свернёт вниз. «Верх-низ»
          отдаёт бок только когда партнёр и правда сбоку.
        </Text>
        <Field label={`Отступ точки крепления — ${value.anchorPadding} px`}>
          <Slider
            size="sm" min={0} max={20} step={1} value={value.anchorPadding}
            onChange={(v) => set('anchorPadding', v)}
            marks={[{ value: 0 }, { value: 6 }, { value: 20 }]}
          />
        </Field>
        <Field label="Где кончается линия">
          <SegmentedControl
            size="xs" fullWidth value={value.connectionPoint}
            onChange={(v) => set('connectionPoint', v as TopologyAppearance['connectionPoint'])}
            data={[
              { value: 'anchor', label: 'В точке крепления' },
              { value: 'boundary', label: 'На границе карточки' },
            ]}
          />
        </Field>

        <Divider my={4} />
        <Group justify="space-between">
          <Button
            size="compact-xs" variant="subtle" leftSection={<IconRotate size={14} />} onClick={reset}
          >
            Сбросить разводку
          </Button>
          <Button size="xs" onClick={onClose}>Закрыть</Button>
        </Group>
      </Stack>
    </Drawer>
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
