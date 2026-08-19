/** Русское склонение существительного по числу — «1 шаблон», «2 шаблона»,
 * «5 шаблонов», а не заглушка вида «шаблон(ов)» (находка 7 проверки
 * удобства). Порядок форм — как в счёте: один, два, пять. */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Число вместе со склонённым словом — самый частый случай использования
 * `pluralRu`, чтобы не собирать шаблонную строку в каждом месте заново. */
export function withCountRu(n: number, one: string, few: string, many: string): string {
  return `${n} ${pluralRu(n, one, few, many)}`;
}

/** Подпись устройства в выпадающих списках: код — то, что напечатано на
 * наклейке, и всегда есть; модель — чтобы отличить одинаковый на вид узел от
 * соседнего, когда кодов на схеме много и они друг на друга похожи; имя —
 * то, как его называют люди, бывает пустым, и потому идёт последним. */
export function deviceLabel(code: string, name?: string | null, templateName?: string | null): string {
  const base = templateName ? `${code} — ${templateName}` : code;
  return name ? `${base} · ${name}` : base;
}

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
  /** Может отсутствовать вовсе: в описании API поле необязательное, и
   * сервер его не присылает у тега верхнего уровня. */
  parent_id?: number | null;
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
