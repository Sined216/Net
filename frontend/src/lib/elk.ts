import ELK, { type ElkExtendedEdge, type ElkNode } from 'elkjs/lib/elk-api';
import ElkWorker from 'elkjs/lib/elk-worker.min.js?worker';

/** Автоматическая раскладка схем — Eclipse Layout Kernel.
 *
 * Обе схемы в системе — и связи, и структура базы — рисуются рядами: узел
 * стоит ниже (правее) тех, от кого он зависит. Раскладка такого рода
 * (метод Сугиямы) — задача, у которой каждый шаг известен полвека и каждый
 * шаг легко сделать посредственно: свой раскладчик разводил ряды заметно
 * хуже на первом же десятке узлов, а на сотне разница уже неприличная.
 * ELK — тот самый раскладчик, что стоит за схемами в Eclipse; здесь он
 * собран в JavaScript, и брать его целиком дешевле, чем годами доводить
 * своё.
 *
 * Три вещи, ради которых он взят, своим кодом не делались вовсе:
 *
 * 1. Вложенность. Группа — это не «узлы рядом», а настоящая рамка со своим
 *    содержимым: ELK раскладывает цех внутри рамки, подцех внутри цеха, и
 *    сам считает, какого размера рамке быть.
 * 2. Порядок в ряду он подбирает не одним барицентром, а с перестановками
 *    и разрешением связей внутри слоя.
 * 3. Координаты — методом Брандеса—Кёпфа: длинные цепочки выходят прямыми,
 *    а не змейкой.
 *
 * Считает он в отдельном потоке (Worker): тысяча узлов — это уже заметные
 * доли секунды, и подвешивать на них окно незачем. Файл раскладчика тяжёлый
 * (полтора мегабайта), поэтому он и не в общей сборке: браузер загружает его
 * тогда, когда впервые нажали «Разложить».
 */

/** Узел раскладки. Размер — только у листьев: размер рамки считает сам ELK
 * по тому, что внутри неё оказалось. */
export interface ElkBox {
  id: string;
  width?: number;
  height?: number;
  /** Рамка, внутри которой этот узел живёт. */
  parent?: string | null;
}

export interface ElkLink {
  from: string;
  to: string;
}

export interface ElkOptions {
  /** Куда растут ряды: вниз (схема связей) или вправо (структура базы). */
  direction: 'DOWN' | 'RIGHT';
  /** Между рядами — там идут линии со своими подписями. */
  layerGap: number;
  /** Между соседями внутри ряда. */
  nodeGap: number;
  /** Отступ от содержимого до рамки. Сверху больше: там подпись группы. */
  padding?: { top: number; side: number };
}

/** Положение узла в общих координатах схемы — левый верхний угол и размер. */
export interface LaidOut {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Раскладчик держится один на все вызовы: каждый новый — это новый поток и
 * повторная загрузка полутора мегабайт. */
let engine: InstanceType<typeof ELK> | null = null;

function layoutEngine() {
  if (!engine) engine = new ELK({ workerFactory: () => new ElkWorker() });
  return engine;
}

export async function layoutLayered(
  boxes: ElkBox[],
  links: ElkLink[],
  options: ElkOptions,
): Promise<Map<string, LaidOut>> {
  const result = new Map<string, LaidOut>();
  if (boxes.length === 0) return result;

  const known = new Set(boxes.map((box) => box.id));
  const parentOf = new Map<string, string | null>(
    boxes.map((box) => [box.id, box.parent && known.has(box.parent) ? box.parent : null]),
  );
  const childrenOf = new Map<string, ElkBox[]>();
  for (const box of boxes) {
    const parent = parentOf.get(box.id) ?? ROOT;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)!.push(box);
  }

  const pad = options.padding ?? { top: 34, side: 22 };
  const build = (box: ElkBox): ElkNode => {
    const inner = childrenOf.get(box.id);
    if (!inner) return { id: box.id, width: box.width ?? 1, height: box.height ?? 1 };
    return {
      id: box.id,
      children: inner.map(build),
      layoutOptions: {
        'elk.padding': `[top=${pad.top},left=${pad.side},bottom=${pad.side},right=${pad.side}]`,
      },
    };
  };

  // Связь кладётся в общую рамку своих концов: ELK ждёт её именно там, а не
  // в корне, — иначе кабель между двумя цехами считается связью самих цехов.
  const chain = (id: string): string[] => {
    const path: string[] = [];
    for (let at = parentOf.get(id) ?? null; at; at = parentOf.get(at) ?? null) path.push(at);
    path.push(ROOT);
    return path;
  };
  const edgesIn = new Map<string, ElkExtendedEdge[]>();
  links.forEach((link, index) => {
    if (!known.has(link.from) || !known.has(link.to) || link.from === link.to) return;
    const up = new Set(chain(link.from));
    const common = chain(link.to).find((id) => up.has(id)) ?? ROOT;
    if (!edgesIn.has(common)) edgesIn.set(common, []);
    edgesIn.get(common)!.push({ id: `e${index}`, sources: [link.from], targets: [link.to] });
  });

  const attach = (node: ElkNode) => {
    const own = edgesIn.get(node.id);
    if (own) node.edges = own;
    for (const child of node.children ?? []) attach(child);
  };

  const graph: ElkNode = {
    id: ROOT,
    children: (childrenOf.get(ROOT) ?? []).map(build),
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': options.direction,
      // Без этого связь через рамку группы раскладке не видна: слои
      // считаются отдельно внутри каждой рамки, и ряды соседних цехов
      // выходят несогласованными.
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(options.layerGap),
      'elk.spacing.nodeNode': String(options.nodeGap),
      // Линии не должны идти вплотную к карточкам: у них по концам подписи
      // портов, и подпись, легшая на чужую карточку, не читается.
      'elk.spacing.edgeNode': String(Math.round(options.nodeGap / 2)),
      'elk.spacing.edgeEdge': '14',
      // Куски сети, ни с чем не соединённые, укладываются рядом, а не
      // растягивают собой первый ряд.
      'elk.separateConnectedComponents': 'true',
      'elk.spacing.componentComponent': String(options.layerGap),
    },
  };
  attach(graph);

  const laid = await layoutEngine().layout(graph);

  // ELK отдаёт координаты внутри своей рамки, а схеме нужны общие: рамку
  // группы двигают вместе с содержимым, и хранится оно в одних координатах.
  const walk = (node: ElkNode, dx: number, dy: number) => {
    const x = dx + (node.x ?? 0);
    const y = dy + (node.y ?? 0);
    if (node.id !== ROOT) {
      result.set(node.id, { x, y, width: node.width ?? 0, height: node.height ?? 0 });
    }
    for (const child of node.children ?? []) walk(child, x, y);
  };
  walk(laid, 0, 0);
  return result;
}

const ROOT = 'elk-root';
