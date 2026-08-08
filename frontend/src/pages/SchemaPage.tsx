import { useEffect, useMemo } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, MarkerType, useNodesState, useEdgesState,
  type Edge,
} from '@xyflow/react';
import { Group, Paper, Stack, Text, Title } from '@mantine/core';
import { useDatabaseSchema } from '../api/hooks';
import {
  TableNode, TABLE_NODE_WIDTH, tableNodeHeight, type TableNodeType,
} from './schema/TableNode';
import type { SchemaTable } from '../api/types';

const nodeTypes = { table: TableNode };

const COLUMN_GAP = 90;
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
 * открывая незнакомую базу.
 */
export function SchemaPage() {
  const { data, isLoading, error } = useDatabaseSchema();
  const tables = useMemo(() => data?.tables ?? [], [data]);

  const { initialNodes, initialEdges } = useMemo(() => buildDiagram(tables), [tables]);
  const [nodes, setNodes, onNodesChange] = useNodesState<TableNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Схема приходит запросом, а начальное состояние React Flow берётся один
  // раз при монтировании — без этого страница осталась бы пустой.
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  if (isLoading) return <Text c="dimmed">Загрузка…</Text>;
  if (error) return <Text c="red">{(error as Error).message}</Text>;

  return (
    <Stack h="100%" gap="sm">
      <Title order={2}>Структура базы данных</Title>
      <Text c="dimmed" size="sm">
        Читается прямо из работающей базы: типы, ограничения и число строк — фактические, а не из описания в
        репозитории. Стрелка идёт от колонки со ссылкой к первичному ключу таблицы, на которую она указывает.
        Таблиц: {tables.length}. Карточки можно перетаскивать, схему — двигать и масштабировать.
      </Text>
      {/* Схема на полтора десятка таблиц не влезает в маленькое окно: во
          весь экран её видно целиком и текст в карточках ещё читается. */}
      <Paper withBorder style={{ height: 'calc(100vh - 230px)', minHeight: 520 }}>
        {nodes.length === 0 ? (
          <Group h="100%" justify="center"><Text c="dimmed">Таблиц нет</Text></Group>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            nodesConnectable={false}
            fitView
            fitViewOptions={{ padding: 0.06 }}
            minZoom={0.15}
            maxZoom={2.5}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        )}
      </Paper>
    </Stack>
  );
}

/** Раскладка по слоям: таблица стоит правее всех, на которые ссылается.
 *
 * Пружинная симуляция здесь хуже — у карточек сильно разная высота, и она
 * их накладывает; а связи между таблицами почти дерево, так что слои дают
 * читаемую схему без случайности.
 */
function buildDiagram(tables: SchemaTable[]) {
  const byName = new Map(tables.map((t) => [t.name, t]));

  const referencedTables = (table: SchemaTable) => {
    const names = new Set<string>();
    for (const column of table.columns) {
      const target = column.references?.split('.')[0];
      // Ссылка на саму себя (вложенные теги) слой не сдвигает.
      if (target && target !== table.name && byName.has(target)) names.add(target);
    }
    return [...names];
  };

  const level = new Map<string, number>();
  const levelOf = (name: string, seen: Set<string>): number => {
    const cached = level.get(name);
    if (cached != null) return cached;
    // Циклическая ссылка не должна уводить в бесконечность: цепочку, которая
    // вернулась к уже пройденной таблице, обрываем.
    if (seen.has(name)) return 0;
    const table = byName.get(name);
    if (!table) return 0;
    seen.add(name);
    const parents = referencedTables(table).map((parent) => levelOf(parent, seen));
    const value = parents.length === 0 ? 0 : Math.max(...parents) + 1;
    level.set(name, value);
    return value;
  };
  for (const table of tables) levelOf(table.name, new Set());

  const columns = new Map<number, SchemaTable[]>();
  for (const table of tables) {
    const depth = level.get(table.name) ?? 0;
    if (!columns.has(depth)) columns.set(depth, []);
    columns.get(depth)!.push(table);
  }

  // Внутри слоя таблицы выстраиваются напротив тех, на которые ссылаются:
  // без этого стрелки идут наискосок через всю схему. Слои считаются слева
  // направо, поэтому положение «родителей» к этому моменту уже известно.
  const centerY = new Map<string, number>();
  const initialNodes: TableNodeType[] = [];
  for (const [depth, group] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    const anchor = (table: SchemaTable) => {
      const parents = referencedTables(table).map((name) => centerY.get(name)).filter((y): y is number => y != null);
      // Таблице без ссылок держаться не за что — такие уходят вниз слоя.
      return parents.length ? parents.reduce((a, b) => a + b, 0) / parents.length : Number.MAX_SAFE_INTEGER;
    };
    const ordered = depth === 0
      ? [...group].sort((a, b) => a.name.localeCompare(b.name))
      : [...group].sort((a, b) => anchor(a) - anchor(b) || a.name.localeCompare(b.name));

    const heights = ordered.map((t) => tableNodeHeight(t.columns.length, !!t.note));
    const total = heights.reduce((a, b) => a + b, 0) + ROW_GAP * (ordered.length - 1);
    let y = -total / 2;  // слои центрируются друг относительно друга
    ordered.forEach((table, index) => {
      initialNodes.push({
        id: table.name,
        type: 'table',
        position: { x: depth * (TABLE_NODE_WIDTH + COLUMN_GAP), y },
        data: {
          name: table.name,
          note: table.note,
          rowCount: table.row_count,
          columns: table.columns,
        },
      });
      centerY.set(table.name, y + heights[index] / 2);
      y += heights[index] + ROW_GAP;
    });
  }

  const initialEdges: Edge[] = [];
  for (const table of tables) {
    for (const column of table.columns) {
      if (!column.references) continue;
      const [target, targetColumn] = column.references.split('.');
      if (!byName.has(target)) continue;
      initialEdges.push({
        id: `${table.name}.${column.name}`,
        source: table.name,
        sourceHandle: column.name,
        target,
        targetHandle: targetColumn,
        style: { stroke: 'var(--mantine-color-blue-4)', strokeWidth: 1.4 },
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--mantine-color-blue-4)', width: 14, height: 14 },
      });
    }
  }

  return { initialNodes, initialEdges };
}
