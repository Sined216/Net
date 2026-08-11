import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Button, Group, Paper, Stack, Text, Title, useComputedColorScheme } from '@mantine/core';
import { IconFocusCentered, IconLayoutDistributeHorizontal } from '@tabler/icons-react';
import { dia, shapes } from '@joint/core';
import { useDatabaseSchema } from '../api/hooks';
import {
  buildTable, rowCenter, tableHeight, tablePaint, TABLE_WIDTH,
} from './schema/joint/tableShape';
import type { SchemaTable } from '../api/types';

const COLUMN_GAP = 110;
const ROW_GAP = 34;

/** Структура базы — как она есть на самом деле, схемой.
 *
 * Данные читаются интроспекцией живой базы, а не из описания схемы в
 * репозитории: показывать нужно то, что реально лежит на диске. Расхождение
 * моделей с `schema.sql` уже случалось, и заметить его по документу было
 * нельзя.
 *
 * Рисуется не списком, а схемой со стрелками внешних ключей: по списку
 * колонок не видно, что во что упирается, а именно это и нужно понять,
 * открывая незнакомую базу. Полотно — то же самое, что у схемы связей
 * (JointJS): один способ рисовать схемы на весь проект вместо двух.
 */
export function SchemaPage() {
  const { data, isLoading, error } = useDatabaseSchema();
  const tables = useMemo(() => data?.tables ?? [], [data]);
  const scheme = useComputedColorScheme('light');

  const holder = useRef<HTMLDivElement>(null);
  const paperRef = useRef<dia.Paper | null>(null);
  const graphRef = useRef<dia.Graph | null>(null);

  const fit = useCallback(() => {
    paperRef.current?.transformToFitContent({ padding: 40, maxScale: 1, useModelGeometry: true });
  }, []);

  // ---------- полотно ----------
  useEffect(() => {
    const element = holder.current;
    if (!element) return;

    const graph = new dia.Graph({}, { cellNamespace: shapes });
    const paper = new dia.Paper({
      model: graph,
      cellViewNamespace: shapes,
      width: Math.max(element.clientWidth, 320),
      height: Math.max(element.clientHeight, 320),
      gridSize: 10,
      // Схему только рассматривают: карточки двигают, а рисовать на ней
      // нечего — ни связей, ни правки.
      interactive: { linkMove: false, labelMove: false },
      defaultConnectionPoint: { name: 'boundary', args: { offset: 1 } },
    });
    element.appendChild(paper.el);
    paper.unfreeze();

    const observer = new ResizeObserver(() => {
      paper.setDimensions(Math.max(element.clientWidth, 320), Math.max(element.clientHeight, 320));
    });
    observer.observe(element);

    // Панорама тягой за пустое место и масштаб колесом — вокруг курсора,
    // как на схеме связей.
    let panning: { x: number; y: number } | null = null;
    paper.on('blank:pointerdown', (event: dia.Event) => {
      panning = { x: event.clientX ?? 0, y: event.clientY ?? 0 };
    });
    paper.on('blank:pointermove cell:pointermove', (event: dia.Event) => {
      if (!panning) return;
      const t = paper.translate();
      paper.translate(t.tx + ((event.clientX ?? 0) - panning.x), t.ty + ((event.clientY ?? 0) - panning.y));
      panning = { x: event.clientX ?? 0, y: event.clientY ?? 0 };
    });
    paper.on('blank:pointerup cell:pointerup', () => { panning = null; });
    paper.on('blank:mousewheel cell:mousewheel', (...args: unknown[]) => {
      const delta = args[args.length - 1] as number;
      const y = args[args.length - 2] as number;
      const x = args[args.length - 3] as number;
      const from = paper.scale().sx;
      const to = Math.min(2.5, Math.max(0.15, from * (delta > 0 ? 1.1 : 0.9)));
      if (to === from) return;
      const t = paper.translate();
      const screenX = x * from + t.tx;
      const screenY = y * from + t.ty;
      paper.scale(to);
      paper.translate(screenX - x * to, screenY - y * to);
    });

    paperRef.current = paper;
    graphRef.current = graph;
    return () => {
      observer.disconnect();
      paper.remove();
      paperRef.current = null;
      graphRef.current = null;
    };
  }, []);

  // ---------- наполнение ----------
  useEffect(() => {
    const graph = graphRef.current;
    const paper = paperRef.current;
    if (!graph || !paper || tables.length === 0) return;

    const paint = tablePaint(scheme === 'dark');
    graph.clear();

    const positions = layout(tables);
    const cells = new Map<string, dia.Element>();
    for (const table of tables) {
      const at = positions.get(table.name);
      if (!at) continue;
      const cell = buildTable(table, at, paint);
      graph.addCell(cell);
      cells.set(table.name, cell);
    }

    // Стрелка идёт от колонки со ссылкой к первичному ключу той таблицы, на
    // которую она указывает: концы цепляются к строкам, а не к краю
    // карточки — иначе на полутора десятках таблиц по линиям уже не понять,
    // что с чем связано.
    const byName = new Map(tables.map((t) => [t.name, t]));
    const line = scheme === 'dark' ? '#4dabf7' : '#339af0';
    for (const table of tables) {
      const source = cells.get(table.name);
      if (!source) continue;
      const hasNote = !!table.note;
      table.columns.forEach((column, index) => {
        if (!column.references) return;
        const [targetName, targetColumn] = column.references.split('.');
        const target = cells.get(targetName);
        const targetTable = byName.get(targetName);
        if (!target || !targetTable || target === source) return;
        const targetIndex = targetTable.columns.findIndex((c) => c.name === targetColumn);
        const targetHasNote = !!targetTable.note;

        graph.addCell(new shapes.standard.Link({
          source: {
            id: source.id,
            anchor: { name: 'left', args: { dy: rowCenter(index, hasNote) - source.size().height / 2 } },
          },
          target: {
            id: target.id,
            anchor: {
              name: 'right',
              args: {
                dy: targetIndex >= 0
                  ? rowCenter(targetIndex, targetHasNote) - target.size().height / 2
                  : 0,
              },
            },
          },
          router: { name: 'manhattan', args: { step: 10, padding: 18 } },
          connector: { name: 'jumpover', args: { size: 4, jump: 'arc' } },
          z: 1,
          attrs: {
            line: {
              stroke: line, strokeWidth: 1.3, opacity: 0.75,
              targetMarker: { type: 'path', d: 'M 8 -4 0 0 8 4 z', fill: line, stroke: 'none' },
            },
          },
        }));
      });
    }

    fit();
  }, [tables, scheme, fit]);

  return (
    <Stack h="100%" gap="sm">
      <Group justify="space-between">
        <Title order={2}>Структура базы данных</Title>
        <Group>
          <Button
            variant="default" leftSection={<IconLayoutDistributeHorizontal size={16} />}
            onClick={() => { relayout(graphRef.current, tables); fit(); }}
          >
            Разложить
          </Button>
          <Button variant="default" leftSection={<IconFocusCentered size={16} />} onClick={fit}>
            Вписать
          </Button>
        </Group>
      </Group>
      <Text c="dimmed" size="sm">
        Читается прямо из работающей базы: типы, ограничения и число строк — фактические, а не из описания в
        репозитории. Стрелка идёт от колонки со ссылкой к первичному ключу таблицы, на которую она указывает.
        Таблиц: {tables.length}. Карточки можно перетаскивать, схему — двигать и масштабировать; «Разложить»
        возвращает автоматическую раскладку по слоям. ◆ — первичный ключ, • — обязательное поле.
      </Text>
      {/* Полотно живёт в разметке всегда, даже пока схема грузится: раньше
          страница до ответа возвращала одну строку «Загрузка…», контейнера
          не существовало, и полотно, создаваемое один раз при монтировании,
          оставалось пустым навсегда. */}
      <Paper withBorder style={{ height: 'calc(100vh - 250px)', minHeight: 520, overflow: 'hidden', position: 'relative' }}>
        <div ref={holder} style={{ width: '100%', height: '100%' }} />
        {(isLoading || error) && (
          <Group justify="center" style={{ position: 'absolute', inset: 0 }}>
            <Text c={error ? 'red' : 'dimmed'}>
              {error ? (error as Error).message : 'Загрузка…'}
            </Text>
          </Group>
        )}
      </Paper>
    </Stack>
  );
}

/** Разложить заново уже нарисованные карточки — не перерисовывая схему. */
function relayout(graph: dia.Graph | null, tables: SchemaTable[]) {
  if (!graph) return;
  const positions = layout(tables);
  for (const cell of graph.getElements()) {
    const at = positions.get(cell.get('tableName'));
    if (at) cell.position(at.x, at.y);
  }
}

/** Автоматическая раскладка по слоям.
 *
 * Таблица стоит правее всех, на которые ссылается: связи между таблицами
 * почти дерево, и слои дают читаемую схему без случайности. Пружинная
 * симуляция здесь хуже — у карточек сильно разная высота, и она их
 * накладывает.
 *
 * Одних слоёв мало. Раньше порядок внутри слоя считался одним проходом слева
 * направо и только по «родителям», а стрелка через несколько слоёв — вроде
 * `sites` → `links` — в раскладке не участвовала вовсе и потому шла напрямик
 * через середину чужих карточек. Из-за этого схему приходилось разбирать
 * руками.
 *
 * Теперь делается то же, что делают все раскладчики таких схем (метод
 * Сугиямы), в трёх шагах: длинная стрелка разбивается проходными точками по
 * одной на каждый пересекаемый слой — дальше она такой же участник раскладки,
 * как таблица, и ей резервируется коридор; порядок внутри слоя подбирается
 * проходами в обе стороны; и только потом считаются координаты.
 */
function layout(tables: SchemaTable[]): Map<string, { x: number; y: number }> {
  const byName = new Map(tables.map((t) => [t.name, t]));

  const refs = new Map<string, Set<string>>(tables.map((t) => [t.name, new Set<string>()]));
  const backRefs = new Map<string, Set<string>>(tables.map((t) => [t.name, new Set<string>()]));
  for (const table of tables) {
    for (const column of table.columns) {
      const target = column.references?.split('.')[0];
      // Ссылка на саму себя (вложенные теги) слой не сдвигает.
      if (!target || target === table.name || !byName.has(target)) continue;
      refs.get(table.name)!.add(target);
      backRefs.get(target)!.add(table.name);
    }
  }

  // Таблицы вообще без связей (alembic_version, code_sequences) в раскладке
  // не участвуют: они никого не держат и никем не держатся, а слой собой
  // растягивают. Их место — отдельным столбцом в стороне.
  const isolated = tables.filter((t) => !refs.get(t.name)!.size && !backRefs.get(t.name)!.size);
  const connected = tables.filter((t) => refs.get(t.name)!.size || backRefs.get(t.name)!.size);

  const level = new Map<string, number>();
  const levelOf = (name: string, seen: Set<string>): number => {
    const cached = level.get(name);
    if (cached != null) return cached;
    // Циклическая ссылка не должна уводить в бесконечность: цепочку, которая
    // вернулась к уже пройденной таблице, обрываем.
    if (seen.has(name)) return 0;
    seen.add(name);
    const parents = [...refs.get(name)!].map((parent) => levelOf(parent, seen));
    const value = parents.length === 0 ? 0 : Math.max(...parents) + 1;
    level.set(name, value);
    return value;
  };
  for (const table of connected) levelOf(table.name, new Set());

  const heightOf = (name: string) => {
    const table = byName.get(name);
    // Проходная точка места не занимает — ей нужен только свой коридор.
    return table ? tableHeight(table.columns.length, !!table.note) : 0;
  };

  const { layers, down, up } = withWaypoints(connected, level, refs);
  orderLayers(layers, down, up);
  const centers = straighten(layers, down, up, heightOf);

  const result = new Map<string, { x: number; y: number }>();
  layers.forEach((layer, depth) => {
    for (const name of layer) {
      if (!byName.has(name)) continue;  // проходные точки наружу не отдаются
      result.set(name, {
        x: depth * (TABLE_WIDTH + COLUMN_GAP),
        y: centers.get(name)! - heightOf(name) / 2,
      });
    }
  });

  // Несвязанные — отдельным столбцом справа, с двойным зазором, чтобы было
  // видно, что они не часть картины, а просто тоже есть.
  let y = 0;
  for (const table of isolated) {
    result.set(table.name, {
      x: layers.length * (TABLE_WIDTH + COLUMN_GAP) + COLUMN_GAP,
      y,
    });
    y += heightOf(table.name) + ROW_GAP;
  }
  return result;
}

/** Разбить стрелки, идущие через несколько слоёв, проходными точками.
 *
 * После этого каждая стрелка соединяет соседние слои — а значит, участвует и
 * в подборе порядка, и в расчёте координат. Без этого шага она невидима для
 * раскладки: слои между её концами про неё не знают и спокойно ставят на её
 * пути карточку.
 */
function withWaypoints(
  tables: SchemaTable[],
  level: Map<string, number>,
  refs: Map<string, Set<string>>,
) {
  const depth = Math.max(0, ...tables.map((t) => level.get(t.name) ?? 0));
  const layers: string[][] = Array.from({ length: depth + 1 }, () => []);
  for (const table of tables) layers[level.get(table.name) ?? 0].push(table.name);
  for (const layer of layers) layer.sort((a, b) => a.localeCompare(b));

  const down = new Map<string, string[]>();  // в следующий слой
  const up = new Map<string, string[]>();    // в предыдущий
  const link = (from: string, to: string) => {
    if (!down.has(from)) down.set(from, []);
    if (!up.has(to)) up.set(to, []);
    down.get(from)!.push(to);
    up.get(to)!.push(from);
  };
  for (const name of layers.flat()) { down.set(name, []); up.set(name, []); }

  for (const table of tables) {
    const childLevel = level.get(table.name)!;
    for (const parent of refs.get(table.name)!) {
      const parentLevel = level.get(parent)!;
      if (parentLevel >= childLevel) continue;  // цикл — разложить его нечем
      let previous = parent;
      for (let l = parentLevel + 1; l < childLevel; l++) {
        const point = `⋯${parent}→${table.name}@${l}`;
        layers[l].push(point);
        down.set(point, []);
        up.set(point, []);
        link(previous, point);
        previous = point;
      }
      link(previous, table.name);
    }
  }
  return { layers, down, up };
}

/** Порядок внутри слоя — так, чтобы стрелки поменьше пересекались.
 *
 * Барицентр: узел встаёт напротив середины тех, с кем связан в соседнем
 * слое. Проходы чередуются, потому что за один проход слева направо ничего
 * не известно про правых соседей, а они тянут не слабее левых. Семи проходов
 * заведомо хватает на два десятка таблиц, и стоят они доли миллисекунды.
 */
function orderLayers(layers: string[][], down: Map<string, string[]>, up: Map<string, string[]>) {
  const indexIn = (layer: string[]) => new Map(layer.map((name, index) => [name, index]));

  for (let pass = 0; pass < 7; pass++) {
    const forward = pass % 2 === 0;
    const order = forward
      ? layers.map((_, i) => i).slice(1)
      : layers.map((_, i) => i).slice(0, -1).reverse();

    for (const i of order) {
      const neighbourIndex = indexIn(layers[forward ? i - 1 : i + 1]);
      const links = forward ? up : down;
      const previous = indexIn(layers[i]);
      const key = new Map<string, number>();
      for (const name of layers[i]) {
        const positions = (links.get(name) ?? [])
          .map((other) => neighbourIndex.get(other))
          .filter((value): value is number => value != null);
        // Узлу без соседей в эту сторону держаться не за что — остаётся там,
        // где стоял, а не улетает в начало слоя.
        key.set(name, positions.length
          ? positions.reduce((a, b) => a + b, 0) / positions.length
          : previous.get(name)!);
      }
      layers[i] = [...layers[i]].sort((a, b) => key.get(a)! - key.get(b)! || a.localeCompare(b));
    }
  }
}

/** Координаты по вертикали: каждый узел тянется к середине своих соседей, но
 * карточки не налезают друг на друга.
 *
 * Без этого слой раскладывался подряд сверху вниз, и стрелка из середины
 * одного слоя уходила в самый низ другого через всю схему. Здесь наоборот:
 * сначала желаемое место, потом раздвигание — ровно то, что раньше
 * приходилось делать мышью.
 */
function straighten(
  layers: string[][],
  down: Map<string, string[]>,
  up: Map<string, string[]>,
  heightOf: (name: string) => number,
): Map<string, number> {
  // Между проходными точками зазор меньше: это коридоры для линий, а не
  // карточки, и разносить их на полный отступ значит раздувать схему.
  const gap = (a: string, b: string) => (heightOf(a) === 0 && heightOf(b) === 0 ? 14 : ROW_GAP);
  const center = new Map<string, number>();

  for (const layer of layers) {
    let y = 0;
    layer.forEach((name, index) => {
      if (index > 0) y += gap(layer[index - 1], name);
      center.set(name, y + heightOf(name) / 2);
      y += heightOf(name);
    });
    const total = y;
    for (const name of layer) center.set(name, center.get(name)! - total / 2);
  }

  for (let pass = 0; pass < 6; pass++) {
    const forward = pass % 2 === 0;
    const order = forward ? layers.map((_, i) => i) : layers.map((_, i) => i).reverse();
    for (const i of order) {
      const links = forward ? up : down;
      const wanted = layers[i].map((name) => {
        const neighbours = (links.get(name) ?? [])
          .map((other) => center.get(other))
          .filter((value): value is number => value != null);
        return neighbours.length
          ? neighbours.reduce((a, b) => a + b, 0) / neighbours.length
          : center.get(name)!;
      });
      // Порядок в слое уже выбран и меняться не должен: узлы только
      // раздвигаются вниз, пока не перестанут накладываться.
      let bottom = -Infinity;
      const placed = layers[i].map((name, index) => {
        const half = heightOf(name) / 2;
        const spacing = index > 0 ? gap(layers[i][index - 1], name) : 0;
        const y = Math.max(wanted[index], bottom + spacing + half);
        bottom = y + half;
        return y;
      });
      // Раздвигание тянет слой вниз — возвращаем его туда, куда он метил.
      const drift = placed.reduce((sum, y, index) => sum + (y - wanted[index]), 0) / placed.length;
      layers[i].forEach((name, index) => center.set(name, placed[index] - drift));
    }
  }
  return center;
}
