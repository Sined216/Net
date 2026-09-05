import type { TopologyGroupOut } from '../../api/types';

/** Уровень вложенности группы: 0 — цех, 1 — участок, 2 — линия. */
export function groupDepth(groups: TopologyGroupOut[], groupId: number | null): number {
  let depth = 0;
  let parentId = groups.find((g) => g.id === groupId)?.parent_id ?? null;
  // Кольцо во вложенности сервер не пропускает, но данные приходят и из
  // чужой сессии — считаем не больше, чем есть групп.
  while (parentId != null && depth <= groups.length) {
    depth += 1;
    parentId = groups.find((g) => g.id === parentId)?.parent_id ?? null;
  }
  return depth;
}

/** Группы в порядке дерева, с глубиной — для списков с отступом. */
export function orderedGroups(groups: TopologyGroupOut[], parentId: number | null = null, depth = 0):
{ group: TopologyGroupOut; depth: number }[] {
  return groups
    .filter((g) => (g.parent_id ?? null) === parentId)
    .flatMap((group) => [{ group, depth }, ...orderedGroups(groups, group.id, depth + 1)]);
}

/** Сколько устройств в группе вместе с её подгруппами.
 *
 * Считать только прямых жильцов бессмысленно ровно там, где вложенность и
 * заводится: у цеха, всё содержимое которого разложено по шкафам, прямым
 * жильцом остаётся один агрегирующий коммутатор — и на рамке цеха с сорока
 * железками писалось «Цех 1 · 1».
 */
export function groupSize(
  groups: TopologyGroupOut[],
  nodes: { topology_group_id?: number | null }[],
  groupId: number,
): number {
  const childrenOf = new Map<number, number[]>();
  for (const group of groups) {
    if (group.parent_id == null) continue;
    const list = childrenOf.get(group.parent_id);
    if (list) list.push(group.id);
    else childrenOf.set(group.parent_id, [group.id]);
  }
  const inside = new Set<number>();
  // Обход в ширину, а не рекурсия: кольцо во вложенности сервер не
  // пропускает, но данные приходят и из чужой сессии, а `Set` из него
  // просто выйдет.
  for (const queue = [groupId]; queue.length > 0;) {
    const at = queue.pop()!;
    if (inside.has(at)) continue;
    inside.add(at);
    queue.push(...(childrenOf.get(at) ?? []));
  }
  return nodes.filter((n) => n.topology_group_id != null && inside.has(n.topology_group_id)).length;
}
