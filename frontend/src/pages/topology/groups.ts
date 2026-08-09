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
