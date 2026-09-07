import type { TreeNodeData } from '@mantine/core';
import type { TagOut, TopologyEdge, TopologyGroupOut, TopologyNode, VlanOut } from '../../api/types';
import { deviceLabel } from '../../lib/utils';

/** Пять деревьев панели рядом со схемой — и подсветка по выбранной ветке.
 *
 * Данные все уже загружены страницей: узлы и рёбра приходят с `/topology`
 * (там же теперь и `vlan_ids`, заход 4 плана), группы и теги — лёгкими
 * запросами без портов, которыми страница и так пользуется (тулбар — тегами
 * для отбора, карточка устройства — группами). Тянуть ради панели ещё и
 * `/device-templates` не нужно: узел уже несёт `template_id`, `template_name`
 * и `device_type` строкой — этого достаточно для деревьев «Типы» и «Модели».
 * Заводить лишний тяжёлый запрос (шаблоны со всеми портами — самый тяжёлый
 * в системе, см. docstring `/topology`) означало бы вернуть на эту же
 * страницу ровно то, ради чего `/topology` и был переделан.
 */

export type TreeKind = 'groups' | 'tags' | 'types' | 'templates' | 'vlans';

export const TREE_KINDS: { value: TreeKind; label: string }[] = [
  { value: 'groups', label: 'Группы' },
  { value: 'tags', label: 'Теги' },
  { value: 'types', label: 'Типы' },
  { value: 'templates', label: 'Модели' },
  { value: 'vlans', label: 'VLAN' },
];

/** Что выбрано в дереве — разбор `value` узла Mantine `Tree` вида «kind:id».
 * Значение внутри одного дерева всегда одно и то же для одной и той же
 * сущности в разных деревьях (например, «Типы» и «Модели» используют
 * одинаковый `type:Коммутатор`) — это не случайность: выбор типа значит
 * одно и то же независимо от того, через какое дерево до него дошли. */
export interface TreeSelection {
  kind: 'group' | 'tag' | 'type' | 'template' | 'vlan' | 'device';
  id: string;
}

export function parseTreeValue(value: string): TreeSelection {
  const sep = value.indexOf(':');
  return { kind: value.slice(0, sep) as TreeSelection['kind'], id: value.slice(sep + 1) };
}

export interface HighlightSet {
  devices: Set<number>;
  links: Set<number>;
}

/** Узел и все его потомки — общий обход для групп и тегов: у обоих
 * вложенность одна и та же форма (`parent_id`), а «выбрал ветку — подсветилось
 * всё под ней» должно работать одинаково для обеих. Цикл, а не рекурсия:
 * порядок элементов от сервера ничем не гарантирован, и потомок вполне может
 * стоять в списке раньше родителя. */
function selfAndDescendants(items: { id: number; parent_id?: number | null }[], rootId: number): Set<number> {
  const out = new Set<number>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of items) {
      if (item.parent_id != null && out.has(item.parent_id) && !out.has(item.id)) {
        out.add(item.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Устройства и кабели, относящиеся к выбранной ветке дерева — то, что
 * подсвечивается на схеме (заход 6 плана).
 *
 * Для ветки (группа/тег/тип/модель/VLAN) кабель подсвечивается, если хоть
 * один его конец входит в подсвеченные устройства — видно и связи внутри
 * ветки, и выходы наружу. Для отдельного устройства — оно само и все его
 * кабели. Для VLAN кабель уже несёт готовый список `vlan_ids` — объединение
 * по обоим концам (см. `_port_vlans` на бэкенде), поэтому для него не нужно
 * идти через набор устройств вовсе.
 */
export function highlightFor(
  selection: TreeSelection,
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  groups: TopologyGroupOut[],
  tags: TagOut[],
): HighlightSet {
  if (selection.kind === 'device') {
    const id = Number(selection.id);
    return {
      devices: new Set([id]),
      links: new Set(edges.filter((e) => e.device_a_id === id || e.device_b_id === id).map((e) => e.link_id)),
    };
  }
  if (selection.kind === 'vlan') {
    const vlanId = Number(selection.id);
    return {
      devices: new Set(nodes.filter((n) => n.vlan_ids.includes(vlanId)).map((n) => n.id)),
      links: new Set(edges.filter((e) => e.vlan_ids.includes(vlanId)).map((e) => e.link_id)),
    };
  }

  let devices: Set<number>;
  if (selection.kind === 'group') {
    const ids = selfAndDescendants(groups, Number(selection.id));
    devices = new Set(nodes.filter((n) => n.topology_group_id != null && ids.has(n.topology_group_id)).map((n) => n.id));
  } else if (selection.kind === 'tag') {
    const ids = selfAndDescendants(tags, Number(selection.id));
    devices = new Set(nodes.filter((n) => n.tag_ids.some((t) => ids.has(t))).map((n) => n.id));
  } else if (selection.kind === 'type') {
    devices = new Set(nodes.filter((n) => n.device_type === selection.id).map((n) => n.id));
  } else {
    devices = new Set(nodes.filter((n) => String(n.template_id) === selection.id).map((n) => n.id));
  }

  const links = new Set(
    edges
      .filter((e) => (e.device_a_id != null && devices.has(e.device_a_id))
        || (e.device_b_id != null && devices.has(e.device_b_id)))
      .map((e) => e.link_id),
  );
  return { devices, links };
}

function deviceLeaf(n: TopologyNode): TreeNodeData {
  return { value: `device:${n.id}`, label: deviceLabel(n.code, n.name) };
}

function buildGroupsTree(nodes: TopologyNode[], groups: TopologyGroupOut[]): TreeNodeData[] {
  const byGroup = new Map<number, TopologyNode[]>();
  for (const n of nodes) {
    if (n.topology_group_id == null) continue;
    (byGroup.get(n.topology_group_id) ?? byGroup.set(n.topology_group_id, []).get(n.topology_group_id)!).push(n);
  }
  const countUnder = (groupId: number) => {
    let total = 0;
    for (const id of selfAndDescendants(groups, groupId)) total += byGroup.get(id)?.length ?? 0;
    return total;
  };
  const build = (parentId: number | null): TreeNodeData[] =>
    groups
      .filter((g) => (g.parent_id ?? null) === parentId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((g) => {
        const children = [...build(g.id), ...(byGroup.get(g.id) ?? []).map(deviceLeaf)];
        return {
          value: `group:${g.id}`,
          label: `${g.name} (${countUnder(g.id)})`,
          children: children.length > 0 ? children : undefined,
        };
      });
  return build(null);
}

function buildTagsTree(nodes: TopologyNode[], tags: TagOut[]): TreeNodeData[] {
  const byTag = new Map<number, TopologyNode[]>();
  for (const n of nodes) {
    for (const tagId of n.tag_ids) {
      (byTag.get(tagId) ?? byTag.set(tagId, []).get(tagId)!).push(n);
    }
  }
  const countUnder = (tagId: number) => {
    const seen = new Set<number>();
    for (const id of selfAndDescendants(tags, tagId)) for (const n of byTag.get(id) ?? []) seen.add(n.id);
    return seen.size;
  };
  const build = (parentId: number | null): TreeNodeData[] =>
    tags
      .filter((t) => (t.parent_id ?? null) === parentId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => {
        const children = [...build(t.id), ...(byTag.get(t.id) ?? []).map(deviceLeaf)];
        return {
          value: `tag:${t.id}`,
          label: `${t.name} (${countUnder(t.id)})`,
          children: children.length > 0 ? children : undefined,
        };
      });
  return build(null);
}

function buildTypesTree(nodes: TopologyNode[]): TreeNodeData[] {
  const byType = new Map<string, TopologyNode[]>();
  for (const n of nodes) {
    const key = n.device_type || '— без типа —';
    (byType.get(key) ?? byType.set(key, []).get(key)!).push(n);
  }
  return [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, list]) => ({
      value: `type:${type}`,
      label: `${type} (${list.length})`,
      children: list.map(deviceLeaf),
    }));
}

function buildTemplatesTree(nodes: TopologyNode[]): TreeNodeData[] {
  const byType = new Map<string, Map<string, { name: string; list: TopologyNode[] }>>();
  for (const n of nodes) {
    const typeKey = n.device_type || '— без типа —';
    const templateKey = String(n.template_id);
    if (!byType.has(typeKey)) byType.set(typeKey, new Map());
    const models = byType.get(typeKey)!;
    if (!models.has(templateKey)) models.set(templateKey, { name: n.template_name || '— без модели —', list: [] });
    models.get(templateKey)!.list.push(n);
  }
  return [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, models]) => {
      const children = [...models.entries()]
        .sort(([, a], [, b]) => a.name.localeCompare(b.name))
        .map(([templateId, { name, list }]) => ({
          value: `template:${templateId}`,
          label: `${name} (${list.length})`,
          children: list.map(deviceLeaf),
        }));
      const total = children.reduce((sum, c) => sum + (c.children?.length ?? 0), 0);
      return { value: `type:${type}`, label: `${type} (${total})`, children };
    });
}

function buildVlansTree(nodes: TopologyNode[], vlans: VlanOut[]): TreeNodeData[] {
  return [...vlans]
    .sort((a, b) => a.vlan_number - b.vlan_number)
    .map((v) => {
      const list = nodes.filter((n) => n.vlan_ids.includes(v.id));
      return {
        value: `vlan:${v.id}`,
        label: `${v.vlan_number}${v.name ? ` · ${v.name}` : ''} (${list.length})`,
        children: list.map(deviceLeaf),
      };
    });
}

export function buildTree(
  kind: TreeKind, nodes: TopologyNode[], groups: TopologyGroupOut[], tags: TagOut[], vlans: VlanOut[],
): TreeNodeData[] {
  switch (kind) {
    case 'groups': return buildGroupsTree(nodes, groups);
    case 'tags': return buildTagsTree(nodes, tags);
    case 'types': return buildTypesTree(nodes);
    case 'templates': return buildTemplatesTree(nodes);
    case 'vlans': return buildVlansTree(nodes, vlans);
  }
}
