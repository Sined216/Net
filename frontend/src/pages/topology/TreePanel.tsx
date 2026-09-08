import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon, Box, filterTreeData, getTreeExpandedState, Group, ScrollArea, SegmentedControl, Stack, Text,
  TextInput, Tree, useTree,
} from '@mantine/core';
import type { RenderTreeNodePayload } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconSearch, IconX } from '@tabler/icons-react';
import type { TagOut, TopologyGroupOut, TopologyNode, VlanOut } from '../../api/types';
import { buildTree, parseTreeValue, TREE_KINDS, type TreeKind, type TreeSelection } from './tree';

/** Панель слева от схемы: пять деревьев (группы, теги, типы, модели, VLAN),
 * выбор ветки в любом из них подсвечивает на схеме то, что к ней относится
 * (заход 6 плана — сама подсветка красится в `TopologyPage`, здесь только
 * дерево и то, что в нём выбрано).
 *
 * Слева, а не справа: справа уже живёт «Разводка» — те же настройки крутят
 * десятками раз подряд, глядя на схему, и две панели у одного края дрались
 * бы за место. В дерево, наоборот, смотрят не отпуская: щёлкнул веткой,
 * увидел результат, щёлкнул следующей — обычная колонка страницы, а не
 * `Drawer`, который приходится открывать заново.
 */

const OPEN_KEY = 'netdoc.topology.treeOpen';
const KIND_KEY = 'netdoc.topology.treeKind';

export function loadTreeOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveTreeOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // Приватный режим — панель просто не переживёт перезагрузку.
  }
}

export function loadTreeKind(): TreeKind {
  try {
    const saved = localStorage.getItem(KIND_KEY);
    return TREE_KINDS.some((k) => k.value === saved) ? (saved as TreeKind) : 'groups';
  } catch {
    return 'groups';
  }
}

export function saveTreeKind(kind: TreeKind): void {
  try {
    localStorage.setItem(KIND_KEY, kind);
  } catch {
    // Приватный режим — переживёт то же самое, что и открытость панели.
  }
}

/** Клик по ветке разворачивает её (если есть чем) и переключает выбор —
 * второй клик по уже выбранной ветке снимает подсветку, а не выбирает её
 * же заново. Заводского поведения `Tree` (`selectOnClick`) для этого не
 * хватает: оно всегда именно выбирает, второй клик по тому же узлу ничего
 * не меняет, а вернуться к «показано всё» можно было бы только сменой
 * дерева. Поэтому `elementProps.onClick` здесь не используется вовсе —
 * оно бы просто выбрало узел заново поверх собственного переключения.
 *
 * `tree.toggleSelected()` для этого же не подходит по другой причине — в
 * Mantine 9.5.1 при одиночном выборе (`multiple: false`, здесь так и
 * оставлено) она считает новое состояние и вместо `setSelectedState` его
 * просто `return`-ит: no-op, никакого клика не происходит вовсе. Поэтому
 * переключение собрано на месте из `select`/`deselect` — оба, в отличие от
 * `toggleSelected`, состояние действительно меняют. */
function renderNode({ node, expanded, hasChildren, elementProps, tree }: RenderTreeNodePayload) {
  return (
    <Group
      gap={6} wrap="nowrap" py={3} {...elementProps}
      onClick={(event) => {
        event.stopPropagation();
        if (hasChildren) tree.toggleExpanded(node.value);
        if (tree.selectedState.includes(node.value)) tree.deselect(node.value);
        else tree.select(node.value);
      }}
      style={{ ...elementProps.style, cursor: 'pointer' }}
    >
      <span style={{ width: 14, flexShrink: 0, display: 'flex' }}>
        {hasChildren && (expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />)}
      </span>
      <Text size="sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {node.label}
      </Text>
    </Group>
  );
}

export function TreePanel({ nodes, groups, tags, vlans, onSelect, onClose }: {
  nodes: TopologyNode[];
  groups: TopologyGroupOut[];
  tags: TagOut[];
  vlans: VlanOut[];
  onSelect: (selection: TreeSelection | null) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<TreeKind>(loadTreeKind);
  const [query, setQuery] = useState('');
  const tree = useTree({
    onSelectedStateChange: (values) => {
      const value = values[0];
      onSelect(value ? parseTreeValue(value) : null);
    },
  });

  const data = useMemo(() => buildTree(kind, nodes, groups, tags, vlans), [kind, nodes, groups, tags, vlans]);
  const filtered = useMemo(() => filterTreeData(data, query), [data, query]);

  // Смена дерева — прежнее выделение к новым веткам может не относиться
  // вовсе (тот же id значит другую сущность в другом дереве), поэтому
  // снимается вместе со сменой; полотно возвращается к обычному виду через
  // onSelect(null). Данные (`nodes`) сюда нарочно не входят: сервер отдаёт
  // новый массив на каждый повторный запрос, даже когда в схеме ничего не
  // изменилось, — сбрасывать выделение на фоновое обновление после чужой
  // правки было бы то ещё раздражение. Устройство, пропавшее из-под
  // выделенной ветки, просто перестаёт подсвечиваться само — `highlightFor`
  // ищет его в уже отфильтрованных данных.
  useEffect(() => {
    tree.clearSelected();
    onSelect(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tree и onSelect стабильны не по ссылке; нужен только kind.
  }, [kind]);

  // Поиск разворачивает совпавшие ветки — иначе результат в свёрнутом узле
  // не отличить от его отсутствия.
  useEffect(() => {
    if (!query.trim()) return;
    tree.setExpandedState(getTreeExpandedState(filtered, '*'));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tree стабилен не по ссылке.
  }, [query, filtered]);

  return (
    <Stack gap="xs" style={{ width: 280, flexShrink: 0, height: '100%' }}>
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm" fw={600}>Дерево</Text>
        <ActionIcon variant="subtle" size="sm" onClick={onClose} aria-label="Закрыть дерево">
          <IconX size={14} />
        </ActionIcon>
      </Group>
      <SegmentedControl
        size="xs" fullWidth
        data={TREE_KINDS.map((k) => ({ value: k.value, label: k.label }))}
        value={kind}
        onChange={(v) => { setKind(v as TreeKind); saveTreeKind(v as TreeKind); }}
      />
      <TextInput
        size="xs" placeholder="Поиск по названию" value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        leftSection={<IconSearch size={14} />}
        rightSection={query ? (
          <ActionIcon variant="subtle" size="sm" onClick={() => setQuery('')} aria-label="Очистить поиск">
            <IconX size={13} />
          </ActionIcon>
        ) : undefined}
      />
      <Box style={{ flex: 1, minHeight: 0, border: '1px solid var(--mantine-color-default-border)', borderRadius: 8 }}>
        <ScrollArea style={{ height: '100%' }} p={6}>
          {filtered.length === 0 ? (
            <Text size="xs" c="dimmed" p="xs">
              {query ? 'Ничего не найдено' : 'Пусто'}
            </Text>
          ) : (
            <Tree
              data={filtered} tree={tree} renderNode={renderNode}
              withLines levelOffset={18}
            />
          )}
        </ScrollArea>
      </Box>
    </Stack>
  );
}
