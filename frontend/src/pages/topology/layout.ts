import { layoutLayered, type ElkAlgorithm } from '../../lib/elk';
import type { Box, Point } from './joint/buildGraph';
import { GROUP_MIN } from './joint/shapes';

/** Простая force-directed раскладка: отталкивание между всеми узлами,
 * пружина вдоль рёбер, лёгкое центрирование. Тот же алгоритм, что и в
 * прежней ванильной версии — даёт органичную (не круговую) картинку по
 * связям.
 *
 * Узлы с сохранённой позицией (fixed: true) не двигаются симуляцией — они
 * приехали из БД (устройство перетащили руками в прошлый раз) — но
 * по-прежнему отталкивают остальные узлы, чтобы новые не легли поверх них.
 * Ради этого свойства симуляция и осталась в системе: разложить пару новых
 * железок, не тронув всё остальное, слоями нельзя.
 *
 * Группировка отдельным проходом в своих координатах не считается — это
 * усложнило бы хранение позиций (сохранённая позиция всегда абсолютная, вне
 * зависимости от группы). Рамка группы рисуется постфактум вокруг уже
 * сложившегося кластера. */
export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed?: boolean;
}

export interface Spring {
  a: LayoutNode;
  b: LayoutNode;
  idealLen: number;
  strength: number;
}

export function computeForceLayout(nodes: LayoutNode[], springs: Spring[], width: number, height: number) {
  const n = nodes.length;
  if (n === 0) return;
  const cx = width / 2, cy = height / 2;
  const movable = nodes.filter((node) => !node.fixed);
  const r0 = Math.min(cx, cy) * 0.6 || 100;
  movable.forEach((node, i) => {
    const angle = (i / (movable.length || 1)) * 2 * Math.PI;
    node.x = cx + r0 * Math.cos(angle);
    node.y = cy + r0 * Math.sin(angle);
    node.vx = 0;
    node.vy = 0;
  });

  const repulsion = 16000, iterations = 300;
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let dist2 = dx * dx + dy * dy;
        if (dist2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; dist2 = 1; }
        const dist = Math.sqrt(dist2);
        const force = repulsion / dist2;
        const fx = (dx / dist) * force, fy = (dy / dist) * force;
        if (!a.fixed) { a.vx += fx; a.vy += fy; }
        if (!b.fixed) { b.vx -= fx; b.vy -= fy; }
      }
    }
    for (const { a, b, idealLen, strength } of springs) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - idealLen) * strength;
      const fx = (dx / dist) * force, fy = (dy / dist) * force;
      if (!a.fixed) { a.vx += fx; a.vy += fy; }
      if (!b.fixed) { b.vx -= fx; b.vy -= fy; }
    }
    for (const node of nodes) {
      if (node.fixed) continue;
      node.vx += (cx - node.x) * 0.002;
      node.vy += (cy - node.y) * 0.002;
      node.vx *= 0.82; node.vy *= 0.82;
      node.x += node.vx; node.y += node.vy;
    }
  }
}

/** Карточка глазами раскладки: свой размер, своя группа. */
export interface AutoCard {
  id: number;
  width: number;
  height: number;
  group: number | null;
}

/** Отступ от карточек до рамки группы. Сверху больше: там подпись. */
const FRAME_PADDING = { top: 46, side: 26 };

/** Автоматическая раскладка всей схемы по связям.
 *
 * Кабель — это и есть та связь, по которой сеть читают: ядро, за ним
 * цеховые коммутаторы, за ними железки. Раньше здесь работала только
 * пружинная симуляция, и картинка выходила круглой — ядро в середине,
 * остальное венком вокруг, уровней не видно. Ряды сверху вниз — то, как эту
 * же схему рисуют от руки.
 *
 * Группы участвуют раскладкой, а не заливкой поверх: цех — настоящая рамка,
 * его содержимое раскладывается внутри неё, подцех внутри цеха, а размер
 * рамок считается по тому, что в них поместилось. Поэтому наружу отдаются и
 * рамки тоже: оставить их на прежних местах значит увезти карточки из своих
 * же рамок.
 */
export async function computeAutoLayout(
  cards: AutoCard[],
  groups: { id: number; parent_id?: number | null }[],
  links: { a: number; b: number }[],
  /** Расстояние между рядами и между узлами в ряду — настройка вида, чтобы
   * можно было раздвинуть тесную схему без правки кода. */
  gaps: { row: number; node: number },
  /** Каким алгоритмом ELK раскладывать — тоже настройка вида. */
  algorithm: ElkAlgorithm,
): Promise<{ positions: Map<number, Point>; boxes: Map<number, Box> }> {
  const busy = new Set<number>();
  for (const card of cards) {
    // Пустая рамка раскладке не нужна: ELK считает размер по содержимому, а
    // у неё его нет. Она остаётся там, где стояла.
    for (let at = card.group; at != null; at = groups.find((g) => g.id === at)?.parent_id ?? null) {
      busy.add(at);
    }
  }
  const laid = await layoutLayered(
    [
      ...groups
        .filter((group) => busy.has(group.id))
        .map((group) => ({
          id: `g${group.id}`,
          parent: group.parent_id != null && busy.has(group.parent_id) ? `g${group.parent_id}` : null,
        })),
      ...cards.map((card) => ({
        id: `d${card.id}`,
        width: card.width,
        height: card.height,
        parent: card.group != null ? `g${card.group}` : null,
      })),
    ],
    links.map((link) => ({ from: `d${link.a}`, to: `d${link.b}` })),
    { algorithm, direction: 'RIGHT', layerGap: gaps.row, nodeGap: gaps.node, padding: FRAME_PADDING },
  );

  const positions = new Map<number, Point>();
  for (const card of cards) {
    const at = laid.get(`d${card.id}`);
    // Схема хранит середину карточки, ELK отдаёт левый верхний угол.
    if (at) positions.set(card.id, { x: at.x + at.width / 2, y: at.y + at.height / 2 });
  }
  const boxes = new Map<number, Box>();
  for (const group of groups) {
    const at = laid.get(`g${group.id}`);
    if (!at) continue;
    boxes.set(group.id, {
      x: at.x, y: at.y,
      width: Math.max(at.width, GROUP_MIN.width),
      height: Math.max(at.height, GROUP_MIN.height),
    });
  }
  return { positions, boxes };
}

