import { useAuth } from './AuthContext';

/** Что человеку позволено — в одном месте, а не проверкой роли по месту.
 *
 * Право всего два, потому что их всего два и на сервере: `edit` — писать в
 * документацию сети (роли admin и editor), `admin` — распоряжаться самой
 * системой: людьми и площадками. Прятать кнопку, за которой стоит 403, —
 * не защита (защищает сервер), а честность интерфейса: кнопка, которая
 * заведомо не сработает, обманывает.
 */
export type Capability = 'edit' | 'admin';

export function useCan(capability: Capability): boolean {
  const { user } = useAuth();
  if (!user) return false;
  if (capability === 'admin') return user.role === 'admin';
  return user.role === 'admin' || user.role === 'editor';
}
