/** Простая force-directed раскладка: отталкивание между всеми узлами,
 * пружина вдоль рёбер (и вдоль "пар одной группы" — см. ниже), лёгкое
 * центрирование. Тот же алгоритм, что и в прежней ванильной версии — даёт
 * органичную (не круговую) раскладку по связям.
 *
 * Узлы с сохранённой позицией (fixed: true) не двигаются симуляцией — они
 * приехали из БД (устройство перетащили руками в прошлый раз) — но
 * по-прежнему отталкивают остальные узлы, чтобы новые не легли поверх них.
 * Группировка не считается отдельным проходом в своих координатах — это
 * усложнило бы персистентность позиций (сохранённая позиция всегда
 * абсолютная, вне зависимости от группы). Вместо этого устройства одной
 * группы просто мягко притягиваются друг к другу в общей симуляции, а
 * рамка группы рисуется постфактум вокруг уже сложившегося кластера. */
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
