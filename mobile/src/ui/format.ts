/** Пропуск значения — приглушённое тире, как во всех таблицах сайта. */
export function dash(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const text = String(value).trim();
  return text === '' ? '—' : text;
}
