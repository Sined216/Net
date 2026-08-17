import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Button, Group, Paper, Stack, Text, Title, useComputedColorScheme } from '@mantine/core';
import { IconFocusCentered, IconLayoutDistributeHorizontal } from '@tabler/icons-react';
import { dia, shapes } from '@joint/core';
import { useDatabaseSchema } from '../api/hooks';
import {
  buildTable, rowCenter, tableHeight, tablePaint, TABLE_WIDTH,
} from './schema/joint/tableShape';
import { layoutLayered, type ElkLink } from '../lib/elk';
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
    // Раскладка считается в отдельном потоке, то есть с ожиданием: пока она
    // идёт, страницу могли и закрыть.
    let dropped = false;

    void layout(tables).then((positions) => {
      if (dropped || !graphRef.current) return;
    const paint = tablePaint(scheme === 'dark');
    graph.clear();

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
    });
    return () => { dropped = true; };
  }, [tables, scheme, fit]);

  return (
    <Stack h="100%" gap="sm">
      <Group justify="space-between">
        <Title order={2}>Структура базы данных</Title>
        <Group>
          <Button
            variant="default" leftSection={<IconLayoutDistributeHorizontal size={16} />}
            onClick={() => { void relayout(graphRef.current, tables).then(fit); }}
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
        возвращает автоматическую раскладку по слоям (ELK). ◆ — первичный ключ, • — обязательное поле.
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
async function relayout(graph: dia.Graph | null, tables: SchemaTable[]) {
  if (!graph) return;
  const positions = await layout(tables);
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
 * Считает ELK — тот же раскладчик, что и на схеме связей, только ряды у него
 * там идут вниз, а здесь вправо. Своя раскладка тут была и работала, но
 * стрелка через несколько слоёв шла напрямик через чужие карточки, и до
 * приличного вида её пришлось бы доводить ровно до того, что в ELK уже
 * сделано.
 */
async function layout(tables: SchemaTable[]): Promise<Map<string, { x: number; y: number }>> {
  const byName = new Map(tables.map((t) => [t.name, t]));

  const arrows: ElkLink[] = [];
  for (const table of tables) {
    for (const column of table.columns) {
      const target = column.references?.split('.')[0];
      // Ссылка на саму себя (вложенные теги) слои не двигает.
      if (!target || target === table.name || !byName.has(target)) continue;
      // Стрелка идёт от таблицы-владельца к дочерней: ссылающаяся встаёт
      // правее той, на которую ссылается.
      arrows.push({ from: target, to: table.name });
    }
  }

  const laid = await layoutLayered(
    tables.map((table) => ({
      id: table.name,
      width: TABLE_WIDTH,
      height: tableHeight(table.columns.length, !!table.note),
    })),
    arrows,
    // Структура базы — не сеть устройств, выбора алгоритма для неё нет:
    // всегда слоями, как таблицы и рисуют от руки.
    { algorithm: 'layered', direction: 'RIGHT', layerGap: COLUMN_GAP, nodeGap: ROW_GAP },
  );

  const result = new Map<string, { x: number; y: number }>();
  for (const [name, at] of laid) result.set(name, { x: at.x, y: at.y });
  return result;
}
