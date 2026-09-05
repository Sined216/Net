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
 * Всё это — про алгоритм по умолчанию, `layered` (тот самый метод
 * Сугиямы). ELK устроен так, что рамки группы раскладывает так же и
 * несколько других его алгоритмов — какой из них лучше ложится на
 * конкретную сеть, решает уже не код, а настройка вида (см. `ElkAlgorithm`
 * ниже): ровное дерево заводской сети выглядит совсем не так, как
 * плотная связка коммутаторов в одном шкафу.
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

/** Алгоритмы раскладки, отобранные вручную из одиннадцати, что несёт в себе
 * elkjs.
 *
 * `layered` — метод Сугиямы, слоями: то, ради чего ELK и был взят изначально
 * (см. заголовок файла), сеть с явным ядром и уровнями читается так же, как
 * её рисуют от руки.
 *
 * `mrtree`, `force`, `stress` проверены вручную временным скриптом на
 * вложенном графе (два устройства в рамке группы плюс третье снаружи,
 * связанное кабелем внутрь неё): вложенность рамок им видна так же, как
 * `layered` — `elk.hierarchyHandling` не специфика одного алгоритма, а общий
 * механизм рекурсивной раскладки вложенных графов, которым пользуются они
 * все. Разница в форме: `mrtree` укладывает сеть деревом от корня, `force`
 * и `stress` — органическим кластером без выраженных рядов, ближе к тому,
 * что раньше делала пружинная симуляция, но с учётом вложенности групп,
 * которой та не умела вовсе.
 *
 * `radial` из одиннадцати демонстративно исключён: тем же способом
 * проверено, что на графе с циклом (а связи устройств — это не дерево,
 * достаточно двух узлов с двумя кабелями между ними) он падает исключением
 * прямо в мидлваре ELK, а не деградирует до худшей раскладки. Остальные —
 * `box`, `rectpacking`, `sporeOverlap`, `sporeCompaction`, `random`, `fixed`
 * — не про сеть связей: раскладывают прямоугольники по площади или ничего
 * не перекладывают вовсе, содержимого ради кабелей в них нет.
 */
export type ElkAlgorithm = 'layered' | 'mrtree' | 'force' | 'stress';

export interface ElkOptions {
  algorithm: ElkAlgorithm;
  /** Куда растут ряды: вниз (схема связей) или вправо (структура базы).
   * Имеет смысл только у `layered` и `mrtree` — `force` и `stress` этот
   * параметр молча игнорируют, ELK не считает это ошибкой. */
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
  // Настройки алгоритма — общие для корня и для каждой рамки. ELK решает
  // раскладку внутри рамки отдельной вложенной задачей и своих настроек у
  // родителя не наследует: заданные только в корне, они действовали бы на
  // расстояния между рамками, а внутри рамки зазоры оставались бы теми,
  // что по умолчанию, — ровно так раньше и было, и раздвинуть тесную группу
  // ползунком не получалось.
  const spacing: Record<string, string> = {
    'elk.algorithm': options.algorithm,
    'elk.direction': options.direction,
    // Каждая рамка раскладывается отдельной задачей.
    //
    // Раньше здесь стояло `INCLUDE_CHILDREN` — одна общая задача на всю
    // схему, чтобы ряды соседних цехов считались согласованно. На сети из
    // двух десятков железок разницы не видно, а на заводской — видно
    // слишком хорошо: 206 устройств в пяти цехах по три шкафа ложились
    // полосой 1667×19616, то есть один к двадцати. Вписать такое в окно
    // значит уменьшить в двадцать пять раз — карточка превращается в
    // штрих 7×3 пиксела. Причина не в настройке зазоров: в шкафу с одного
    // коммутатора висит дюжина железок, все они попадают в один слой, а
    // слой ELK выкладывает в колонку и переносить не умеет — `layered`
    // переносит последовательность слоёв, а не длинный слой.
    //
    // Отдельная задача на рамку разрывает эту колонку: шкаф ложится
    // блоком, цех — блоком из шкафов, и та же сеть занимает 5066×4106 —
    // вписывается в окно вчетверо крупнее (замерено на тех же данных).
    // Цена — ряды в соседних цехах больше не выравниваются между собой;
    // на схеме, где цех и так читается как отдельный блок, это дешевле
    // нечитаемой полосы.
    'elk.hierarchyHandling': 'SEPARATE_CHILDREN',
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
  };
  // У `stress` свой параметр расстояния — обычный `elk.spacing.nodeNode`
  // это только нижняя граница при столкновении, а не то, к чему алгоритм
  // стремится: без `desiredEdgeLength` он тянет связанные узлы друг к другу
  // теснее их собственного размера. Проверено на паре связанных карточек
  // 160×60 без этой настройки — легли внахлёст, друг на друге, при любом
  // значении `elk.spacing.nodeNode`. Отступ считается от размера карточек,
  // а не константой: крупная схема просит и расстояние побольше.
  if (options.algorithm === 'stress') {
    const leaves = boxes.filter((box) => box.width != null && box.height != null);
    const avgSize = leaves.length
      ? leaves.reduce((sum, box) => sum + (box.width! + box.height!) / 2, 0) / leaves.length
      : 160;
    spacing['elk.stress.desiredEdgeLength'] = String(Math.round(avgSize + options.layerGap));
  }

  // Рамка, внутри которой одна железка раздаёт связь всем остальным, —
  // это шкаф: коммутатор доступа и висящие на нём станки, камеры, АРМы.
  // Рядами такое не раскладывается: все висящие попадают в один слой, а
  // слой — это колонка, которую ELK не переносит. Пятнадцать шкафов по
  // дюжине железок и дают ту самую полосу.
  //
  // Внутри такой рамки читать нечего: связь у каждой ровно одна и ведёт
  // она в одно и то же место. Поэтому содержимое просто плотно
  // укладывается прямоугольниками (`rectpacking`) — шкаф выходит блоком
  // четыре на четыре вместо колонки в тринадцать карточек.
  //
  // Условие узкое намеренно. Два коммутатора в шкафу — это уже не звезда,
  // и какой из них кого кормит, по схеме должно быть видно: такая рамка
  // раскладывается рядами, как и раньше. `rectpacking` про связи не знает
  // вовсе и в остальных случаях потерял бы смысл схемы.
  const starHub = (id: string): boolean => {
    const inner = childrenOf.get(id);
    if (!inner || inner.length < STAR_MIN) return false;
    // Только листья: рамка с подрамками — это цех, а не шкаф.
    if (inner.some((child) => childrenOf.has(child.id))) return false;
    const mine = new Set(inner.map((child) => child.id));
    const internal = links.filter((link) => mine.has(link.from) && mine.has(link.to));
    // Связей внутри нет вовсе — раскладывать по ним нечего, тем более
    // укладываем плотно.
    if (internal.length === 0) return true;
    // Звезда — это когда один и тот же узел стоит на каждом кабеле внутри
    // рамки. Кандидатов ровно два: концы первого же кабеля.
    const [first] = internal;
    return [first.from, first.to].some(
      (hub) => internal.every((link) => link.from === hub || link.to === hub),
    );
  };

  const build = (box: ElkBox): ElkNode => {
    const inner = childrenOf.get(box.id);
    if (!inner) return { id: box.id, width: box.width ?? 1, height: box.height ?? 1 };
    return {
      id: box.id,
      children: inner.map(build),
      layoutOptions: {
        ...spacing,
        ...(starHub(box.id) ? {
          'elk.algorithm': 'rectpacking',
          // Целевая пропорция блока — под экран, а не под квадрат: схему
          // смотрят в широком окне.
          'elk.aspectRatio': '1.7',
          'elk.spacing.nodeNode': String(Math.round(options.nodeGap * 0.6)),
        } : null),
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
    layoutOptions: spacing,
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

/** С какого числа железок в шкафу колонка становится проблемой. Пять-шесть
 * карточек в столбик читаются нормально и остаются рядами. */
const STAR_MIN = 7;
