import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Badge, Group, Text } from '@mantine/core';
import { IconKey } from '@tabler/icons-react';
import type { SchemaColumn } from '../../api/types';

export interface TableNodeData extends Record<string, unknown> {
  name: string;
  note?: string | null;
  rowCount: number;
  columns: SchemaColumn[];
}

export type TableNodeType = Node<TableNodeData, 'table'>;

export const TABLE_NODE_WIDTH = 268;
export const TABLE_ROW_HEIGHT = 22;
export const TABLE_HEADER_HEIGHT = 42;

/** Высота карточки таблицы — нужна снаружи, чтобы разложить таблицы по
 * колонкам, не накладывая друг на друга. */
export function tableNodeHeight(columns: number, hasNote: boolean): number {
  return TABLE_HEADER_HEIGHT + (hasNote ? 26 : 0) + columns * TABLE_ROW_HEIGHT + 8;
}

/** Таблица базы на схеме: заголовок и список колонок.
 *
 * Точки подключения висят на самих строках колонок, а не на краю карточки:
 * стрелка внешнего ключа должна выходить из той колонки, которая ссылается,
 * иначе на полутора десятках таблиц по линиям уже не понять, что с чем
 * связано.
 */
export function TableNode({ data }: NodeProps<TableNodeType>) {
  return (
    <div
      style={{
        width: TABLE_NODE_WIDTH,
        borderRadius: 8,
        border: '1px solid var(--mantine-color-default-border)',
        background: 'var(--mantine-color-body)',
        overflow: 'hidden',
        boxShadow: '0 1px 8px rgba(0,0,0,0.08)',
      }}
    >
      <Group
        justify="space-between" wrap="nowrap" gap={6}
        style={{
          padding: '6px 9px',
          background: 'var(--mantine-color-default-hover)',
          borderBottom: '1px solid var(--mantine-color-default-border)',
        }}
      >
        <Text size="sm" fw={700} ff="monospace" truncate>{data.name}</Text>
        <Badge size="xs" variant="light" color="gray">{data.rowCount}</Badge>
      </Group>

      {data.note && (
        <Text size="10px" c="dimmed" px={9} py={4} lh={1.3} lineClamp={2}>{data.note}</Text>
      )}

      <div style={{ padding: '2px 0 6px' }}>
        {data.columns.map((column) => (
          <div
            key={column.name}
            style={{
              position: 'relative',
              height: TABLE_ROW_HEIGHT,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 9px',
            }}
          >
            {/* Ссылающаяся колонка — начало стрелки, ключевая — её цель.
                Начало слева, цель справа: таблица стоит правее тех, на
                которые ссылается, поэтому стрелка идёт справа налево и не
                огибает карточку. */}
            {column.references && (
              <Handle
                type="source" id={column.name} position={Position.Left}
                style={{ left: -4, width: 6, height: 6, background: 'var(--mantine-color-blue-5)', border: 'none' }}
              />
            )}
            {column.primary_key && (
              <Handle
                type="target" id={column.name} position={Position.Right}
                style={{ right: -4, width: 6, height: 6, background: 'var(--mantine-color-yellow-6)', border: 'none' }}
              />
            )}
            <Text size="11px" ff="monospace" fw={column.primary_key ? 700 : 400} truncate style={{ flex: 1, minWidth: 0 }}>
              {column.name}
            </Text>
            {column.primary_key && <IconKey size={11} color="var(--mantine-color-yellow-6)" />}
            {column.unique && !column.primary_key && (
              <Text size="9px" c="grape" fw={700}>uniq</Text>
            )}
            {!column.nullable && !column.primary_key && (
              <Text size="9px" c="dimmed" title="обязательное поле">•</Text>
            )}
            <Text size="10px" c="dimmed" ff="monospace" style={{ flexShrink: 0 }}>
              {shortType(column.type)}
            </Text>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Тип в карточке — коротко: полное «CHARACTER VARYING(50)» вытесняет имя
 * колонки, ради которого всё и рисуется. */
function shortType(type: string): string {
  const compact = type
    .replace('CHARACTER VARYING', 'VARCHAR')
    .replace('TIMESTAMP WITHOUT TIME ZONE', 'TIMESTAMP')
    .replace('DOUBLE PRECISION', 'FLOAT');
  return compact.length > 12 ? `${compact.slice(0, 11)}…` : compact;
}
