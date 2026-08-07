/** Пустая строка из формы -> null, чтобы не ловить ошибки INET/MACADDR на бэкенде. */
export function nn(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}
export function nnInt(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}
export function nnFloat(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

export interface TagLike {
  id: number;
  name: string;
  parent_id: number | null;
  color?: string | null;
}

/** Плоский список тегов в порядке дерева (родитель, потом дети), с глубиной
 * для отступа — вложенность только для организации отображения. */
export function flattenTagsOrdered<T extends TagLike>(tags: T[]): { tag: T; depth: number }[] {
  const byParent = new Map<number | null, T[]>();
  for (const t of tags) {
    const key = t.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(t);
  }
  const out: { tag: T; depth: number }[] = [];
  function walk(parentId: number | null, depth: number) {
    const children = (byParent.get(parentId) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    for (const t of children) {
      out.push({ tag: t, depth });
      walk(t.id, depth + 1);
    }
  }
  walk(null, 0);
  return out;
}

export function tagPath<T extends TagLike>(tags: T[], id: number): string {
  const byId = new Map(tags.map((t) => [t.id, t]));
  const parts: string[] = [];
  let t: T | undefined = byId.get(id);
  while (t) {
    parts.unshift(t.name);
    t = t.parent_id ? byId.get(t.parent_id) : undefined;
  }
  return parts.join(' / ');
}
