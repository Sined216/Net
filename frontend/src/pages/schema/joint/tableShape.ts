import { dia } from '@joint/core';
import type { SchemaColumn, SchemaTable } from '../../../api/types';

/** Карточка таблицы базы на схеме: заголовок, число строк, примечание и
 * список колонок.
 *
 * Разметка собирается под каждую таблицу отдельно — числом колонок они
 * отличаются, а SVG-фигура в JointJS не умеет повторять элемент списком.
 * Зато карточка получается обычной ячейкой полотна: её двигают, к её
 * строкам цепляются стрелки внешних ключей, и всё это той же машинерией,
 * что и схема связей.
 */

export const TABLE_WIDTH = 268;
export const ROW_HEIGHT = 22;
export const HEADER_HEIGHT = 42;
export const NOTE_HEIGHT = 26;

export function tableHeight(columns: number, hasNote: boolean): number {
  return HEADER_HEIGHT + (hasNote ? NOTE_HEIGHT : 0) + columns * ROW_HEIGHT + 8;
}

/** Вертикаль середины строки колонки внутри карточки. */
export function rowCenter(index: number, hasNote: boolean): number {
  return HEADER_HEIGHT + (hasNote ? NOTE_HEIGHT : 0) + index * ROW_HEIGHT + ROW_HEIGHT / 2;
}

export interface TablePaint {
  body: string;
  header: string;
  border: string;
  title: string;
  text: string;
  dimmed: string;
  key: string;
  unique: string;
}

export function tablePaint(dark: boolean): TablePaint {
  return dark
    ? {
      body: '#25262b', header: '#2c2e33', border: '#5c5f66',
      title: '#f8f9fa', text: '#c1c2c5', dimmed: '#909296',
      key: '#fab005', unique: '#da77f2',
    }
    : {
      body: '#ffffff', header: '#f1f3f5', border: '#dee2e6',
      title: '#212529', text: '#343a40', dimmed: '#868e96',
      key: '#e8a90c', unique: '#ae3ec9',
    };
}

export const TableShape = dia.Element.define('netdoc.Table', {}, {
  // Разметка и оформление приходят при создании — они зависят от состава
  // колонок конкретной таблицы.
});

/** Собрать ячейку под одну таблицу. */
export function buildTable(table: SchemaTable, position: { x: number; y: number },
                            paint: TablePaint): dia.Element {
  const hasNote = !!table.note;
  const height = tableHeight(table.columns.length, hasNote);

  const markup: dia.MarkupJSON = [
    { tagName: 'rect', selector: 'body' },
    { tagName: 'rect', selector: 'header' },
    { tagName: 'text', selector: 'title' },
    { tagName: 'text', selector: 'count' },
  ];
  const attrs: Record<string, unknown> = {
    body: {
      width: 'calc(w)', height: 'calc(h)', rx: 8, ry: 8,
      fill: paint.body, stroke: paint.border, strokeWidth: 1,
    },
    header: {
      x: 1, y: 1, width: 'calc(w-2)', height: HEADER_HEIGHT - 1, rx: 7, ry: 7,
      fill: paint.header, stroke: 'none',
    },
    title: {
      x: 10, y: 26, fontSize: 13, fontWeight: 700, fill: paint.title,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', text: table.name,
    },
    count: {
      x: 'calc(w-10)', y: 26, fontSize: 11, textAnchor: 'end', fill: paint.dimmed,
      fontFamily: 'inherit', text: `${table.row_count}`,
    },
  };

  if (hasNote) {
    markup.push({ tagName: 'text', selector: 'note' });
    attrs.note = {
      x: 10, y: HEADER_HEIGHT + 14, fontSize: 10, fill: paint.dimmed, fontFamily: 'inherit',
      text: table.note,
      textWrap: { width: TABLE_WIDTH - 20, maxLineCount: 1, ellipsis: true },
    };
  }

  table.columns.forEach((column, index) => {
    const y = rowCenter(index, hasNote) + 4;  // +4: базовая линия текста
    markup.push({ tagName: 'text', selector: `name${index}` });
    markup.push({ tagName: 'text', selector: `type${index}` });
    attrs[`name${index}`] = {
      x: 10, y, fontSize: 11, fontWeight: column.primary_key ? 700 : 400,
      fill: column.primary_key ? paint.key : paint.text,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      text: columnLabel(column),
      textWrap: { width: TABLE_WIDTH - 110, maxLineCount: 1, ellipsis: true },
    };
    attrs[`type${index}`] = {
      x: 'calc(w-10)', y, fontSize: 10, textAnchor: 'end',
      fill: column.unique && !column.primary_key ? paint.unique : paint.dimmed,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      text: shortType(column.type),
    };
  });

  return new TableShape({
    position,
    size: { width: TABLE_WIDTH, height },
    kind: 'table',
    tableName: table.name,
    markup,
    attrs,
  });
}

/** Ключ и обязательность — значками в самом названии: отдельными фигурами
 * на полтора десятка таблиц это сотни лишних элементов SVG. */
function columnLabel(column: SchemaColumn): string {
  const marks = [
    column.primary_key ? '◆' : '',
    !column.nullable && !column.primary_key ? '•' : '',
  ].filter(Boolean).join('');
  return marks ? `${marks} ${column.name}` : column.name;
}

/** Тип коротко: полное «CHARACTER VARYING(50)» вытесняет имя колонки, ради
 * которого всё и рисуется. */
function shortType(type: string): string {
  const compact = type
    .replace('CHARACTER VARYING', 'VARCHAR')
    .replace('TIMESTAMP WITHOUT TIME ZONE', 'TIMESTAMP')
    .replace('DOUBLE PRECISION', 'FLOAT');
  return compact.length > 12 ? `${compact.slice(0, 11)}…` : compact;
}
