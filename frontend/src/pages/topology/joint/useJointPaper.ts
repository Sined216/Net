import { useCallback, useEffect, useRef, useState } from 'react';
import { dia, g, highlighters, shapes } from '@joint/core';
import { canvasColors, loadAppearance, type TopologyAppearance } from '../appearance';
import { groupResizeTool } from './tools';
import type { Box } from './buildGraph';

/** Полотно JointJS и всё, что на нём происходит мышью: панорама, масштаб,
 * выделение, перетаскивание, протягивание кабеля, Delete.
 *
 * Вынесено из страницы отдельно от наполнения графа: обработчики ставятся
 * один раз на всю жизнь полотна, а данные под ними меняются на каждый ответ
 * сервера. Держать это в одном файле с состоянием окон значило смешивать
 * две разные по времени жизни вещи — и каждая правка требовала помнить, что
 * из окружения замкнётся в обработчике навсегда.
 *
 * Поэтому сам хук ничего не решает: что делать по щелчку и куда записывать
 * новую позицию, ему отдают ссылками. Ссылка, а не значение, — намеренно:
 * обработчики читают её в момент события и видят свежее состояние страницы,
 * а не то, что было на рендере, когда создавалось полотно.
 *
 * Кнопки мыши разведены по смыслу, а не по привычке:
 *
 * - средняя — только навигация, панорама. И по пустому месту, и по объектам:
 *   схему таскают, когда смотрят, а смотрят и поверх узлов тоже.
 * - левая — только работа с объектами: выделить, потянуть, обвести рамкой
 *   пачку. За пустое место левой сразу начинается рамка выделения — раньше
 *   для неё требовался Shift, потому что жест был занят панорамой.
 * - правая — меню объекта. Действия, которые раньше жили кнопками поверх
 *   схемы, теперь только здесь.
 */

export type Selection = { kind: 'device' | 'group'; id: number } | null;

/** Выделенное рамкой. Устройства и группы держатся раздельно: рамка может
 * захватить и то и другое, а обходятся с ними по-разному — у группы своя
 * геометрия и своё удаление. */
export interface Marked {
  devices: Set<number>;
  groups: Set<number>;
}

const emptyMarked = (): Marked => ({ devices: new Set(), groups: new Set() });
const markedSize = (marked: Marked) => marked.devices.size + marked.groups.size;

/** Что человек вызвал правой кнопкой и в какой точке экрана. `target` пуст —
 * щёлкнули по пустому месту. */
export interface MenuRequest {
  target: Selection;
  x: number;
  y: number;
}

/** Что панель действий умеет делать с узлом и с рамкой. */
export interface JointActions {
  edit: (deviceId: number) => void;
  copy: (deviceId: number) => void;
  regroup: (deviceId: number) => void;
  remove: (deviceId: number) => void;
  editGroup: (groupId: number) => void;
  addSubgroup: (groupId: number) => void;
  /** Завести устройство прямо в этой группе — не заводить отдельно и потом
   * перекладывать. */
  addDeviceToGroup: (groupId: number) => void;
  removeGroup: (groupId: number) => void;
  /** Разложить содержимое группы рядами внутри её рамки. */
  layoutGroup: (groupId: number) => void;
}

/** Что полотно сообщает странице. */
export interface PaperHandlers {
  /** Протянули кабель от одной ячейки к другой. */
  onConnect: (source: dia.Element, target: dia.Element) => void;
  onLinkClick: (linkId: number) => void;
  /** Устройства, переехавшие одним жестом. Списком, а не по одному: за
   * рамку группы уезжает всё её содержимое, а выделенную рамкой пачку тянут
   * целиком — и отменять такое движение надо тоже целиком. */
  onDevicesMoved: (moves: { id: number; x: number; y: number }[]) => void;
  /** Рамки, переехавшие одним жестом. Списком по той же причине, что и
   * устройства: за рамкой группы едут и рамки подгрупп, и записать надо все
   * — иначе подгруппы возвращаются на прежнее место при первой перерисовке. */
  onGroupsMoved: (frames: { id: number; box: Box }[]) => void;
  /** Delete по выделенному. Когда рамкой выделено хоть что-то, `selection`
   * не в счёт: удаляется пачка. */
  onDelete: (selection: Selection, marked: Marked) => void;
}

export interface JointPaper {
  /** Контейнер под полотно — вешается на `<div ref=…>`. */
  holder: React.RefObject<HTMLDivElement | null>;
  paperRef: React.RefObject<dia.Paper | null>;
  graphRef: React.RefObject<dia.Graph | null>;
  selection: React.RefObject<Selection>;
  /** Выделенное рамкой. Пусто, пока рамкой не пользовались. */
  marked: React.RefObject<Marked>;
  /** Сколько всего выделено рамкой — для подписи на странице. */
  markedCount: number;
  /** Снять выделение рамкой. */
  clearMarked: () => void;
  /** Перерисовать подсветку и ручку размера у выделенного. Нужно после
   * наполнения графа: ячейки создаются заново, а выделенным остаётся тот же
   * объект. */
  refreshTools: () => void;
  /** Меню объекта, вызванное правой кнопкой. Рисует его страница: меню — это
   * обычная разметка, а не часть схемы, и жить оно должно там же, где окна,
   * которые открывают его пункты. */
  menu: MenuRequest | null;
  closeMenu: () => void;
  /** Устройство, от которого сейчас тянут кабель. Протягивание — жест, и
   * пунктом меню быть не может; поэтому пункт включает режим: следующий
   * щелчок по другому устройству и создаёт связь. Пусто — режим выключен. */
  connectFrom: number | null;
  startConnect: (deviceId: number) => void;
  cancelConnect: () => void;
}

/** Загнать узел внутрь рамки его группы. Отступы те же, что при сборке
 * схемы: сверху больше, там подпись группы. */
function insideParent(element: dia.Element, x: number, y: number): { x: number; y: number } {
  const parent = element.getParentCell() as dia.Element | null;
  if (!parent) return { x, y };
  const box = parent.getBBox();
  const size = element.size();
  const pad = 8;
  return {
    x: Math.min(Math.max(x, box.x + pad), Math.max(box.x + pad, box.x + box.width - size.width - pad)),
    y: Math.min(Math.max(y, box.y + 24), Math.max(box.y + 24, box.y + box.height - size.height - pad)),
  };
}

/** Фон полотна из настроек вида — своими именами JointJS.
 *
 * Цвет зависит от темы: сетка — это подсказка о масштабе, а не часть схемы,
 * и заметнее самой схемы быть не должна. Светло-серый, годящийся на белом
 * полотне, на тёмном превращается в яркую рябь по всему экрану — тем
 * заметнее, чем темнее фон. */
function gridFor(background: TopologyAppearance['background'], scheme: 'light' | 'dark') {
  const color = scheme === 'dark' ? '#2a2e35' : '#ced4da';
  const mesh = scheme === 'dark' ? '#22262c' : '#e9ecef';
  const grid: Record<TopologyAppearance['background'], dia.Paper.GridOptions | false> = {
    dots: { name: 'dot', color, thickness: 1 },
    lines: { name: 'mesh', color: mesh, thickness: 1 },
    cross: { name: 'doubleMesh', color: mesh, thickness: 1 },
    none: false,
  };
  return grid[background];
}

export function useJointPaper({ canEdit, scheme, background, handlers }: {
  canEdit: boolean;
  scheme: 'light' | 'dark';
  background: TopologyAppearance['background'];
  handlers: React.RefObject<PaperHandlers>;
}): JointPaper {
  const holder = useRef<HTMLDivElement>(null);
  const paperRef = useRef<dia.Paper | null>(null);
  const graphRef = useRef<dia.Graph | null>(null);
  const selection = useRef<Selection>(null);
  /** Выделенное рамкой. Держится ссылкой, потому что читается из
   * обработчиков полотна, поставленных один раз; счётчик рядом — чтобы
   * страница могла показать, сколько выделено. */
  const marked = useRef<Marked>(emptyMarked());
  const [markedCount, setMarkedCount] = useState(0);
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const [connectFrom, setConnectFrom] = useState<number | null>(null);
  /** Режим протягивания читается из обработчиков полотна, поставленных один
   * раз, — им нужно свежее значение, а не то, что было на рендере. */
  const connectFromRef = useRef<number | null>(null);
  connectFromRef.current = connectFrom;

  /** Показать подсветку выделенного и ручку размера у выделенной рамки. */
  const showTools = useCallback((paper: dia.Paper, target: Selection) => {
    const paint = canvasColors(scheme);
    paper.removeTools();
    highlighters.stroke.removeAll(paper);

    const outline = (view: dia.ElementView, name: string, dashed: boolean) => {
      highlighters.stroke.add(view, 'body', name, {
        padding: 3, rx: 12, ry: 12,
        attrs: {
          stroke: '#1971c2', 'stroke-width': 2,
          ...(dashed ? { 'stroke-dasharray': '5 3' } : {}),
        },
      });
    };

    // Выделенные рамкой обводятся все: по обводке и видно, что подвинется
    // и что удалится. Рамки групп обводятся так же, как устройства, — с той
    // же поры, как рамка выделения научилась их захватывать.
    for (const element of paper.model.getElements()) {
      const kind = element.get('kind');
      const id = kind === 'device' ? element.get('deviceId')
        : kind === 'group' ? element.get('groupId') : null;
      if (id == null) continue;
      const set = kind === 'device' ? marked.current.devices : marked.current.groups;
      if (!set.has(id)) continue;
      const view = element.findView(paper) as dia.ElementView | undefined;
      if (view) outline(view, `marked-${kind}-${id}`, true);
    }

    // Обводка одиночного выделения — когда рамкой не выделено ничего:
    // иначе на схеме были бы две разные подсветки об одном и том же.
    if (markedSize(marked.current) > 0) return;
    if (!target) return;
    const key = target.kind === 'device' ? 'deviceId' : 'groupId';
    const cell = paper.model.getElements().find(
      (el) => el.get('kind') === target.kind && el.get(key) === target.id,
    );
    const view = cell?.findView(paper) as dia.ElementView | undefined;
    if (!cell || !view) return;
    if (target.kind === 'device') {
      outline(view, 'selected', false);
    } else if (canEdit) {
      // Рамке — ручка размера: тянуть угол пунктом меню не сделаешь.
      view.addTools(groupResizeTool(cell.get('accent') ?? '#4dabf7', paint));
    }
  }, [canEdit, scheme]);

  /** Обработчики полотна ставятся один раз, а показ панели зависит от темы
   * и масштаба — поэтому он берётся через ссылку, а не замыкается. */
  const showToolsRef = useRef(showTools);
  showToolsRef.current = showTools;

  const refreshTools = useCallback(() => {
    const paper = paperRef.current;
    if (paper) showToolsRef.current(paper, selection.current);
  }, []);

  const clearMarked = useCallback(() => {
    marked.current = emptyMarked();
    setMarkedCount(0);
    const paper = paperRef.current;
    if (paper) showToolsRef.current(paper, selection.current);
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);
  const startConnect = useCallback((deviceId: number) => {
    setMenu(null);
    setConnectFrom(deviceId);
  }, []);
  const cancelConnect = useCallback(() => setConnectFrom(null), []);

  // ---------- полотно ----------
  useEffect(() => {
    const element = holder.current;
    if (!element) return;

    const graph = new dia.Graph({}, { cellNamespace: shapes });
    // Своего контейнера полотну не отдаём: `paper.remove()` уносит именно тот
    // элемент, который ему передали, и после повторного монтирования рисовать
    // было бы уже некуда. Размер — числами: на контейнере нулевого размера
    // JointJS падает с невырожденной матрицей.
    const paper = new dia.Paper({
      model: graph,
      cellViewNamespace: shapes,
      width: Math.max(element.clientWidth, 320),
      height: Math.max(element.clientHeight, 320),
      gridSize: 10,
      drawGrid: gridFor(loadAppearance().background, scheme),
      // Сколько движений мыши между нажатием и отпусканием ещё считается
      // щелчком. По умолчанию — ноль: дрогнула рука на пиксель, и JointJS
      // считает это перетаскиванием, а клика не было вовсе. Из-за этого
      // панель действий у узла и правка связи открывались с третьего-пятого
      // раза.
      clickThreshold: 6,
      // Кабель тянут от кнопки на панели узла, поэтому «висящих» концов у
      // временной линии быть не должно: отпустил мимо — линия исчезла.
      linkPinning: false,
      defaultLink: () => new shapes.standard.Link({
        attrs: {
          line: {
            stroke: '#1971c2', strokeWidth: 2, strokeDasharray: '6 4',
            targetMarker: { type: 'path', d: 'M 8 -4 0 0 8 4 z', fill: '#1971c2' },
          },
        },
      }),
      validateConnection: (sourceView, _sm, targetView, _tm) => {
        const source = sourceView?.model as dia.Element | undefined;
        const target = targetView?.model as dia.Element | undefined;
        if (!source || !target || source === target) return false;
        const kinds = [source.get('kind'), target.get('kind')];
        // Кабель соединяет два устройства либо повисший конец с устройством.
        if (kinds.includes('group')) return false;
        return kinds.filter((k) => k === 'device').length >= 1;
      },
      // Узел не выходит за рамку своей группы: состав группы меняется только
      // явно, а не перетаскиванием.
      restrictTranslate: (elementView) => {
        const parent = elementView.model.getParentCell() as dia.Element | null;
        // `false` — «двигай куда хочешь»: у узла без группы ограничений нет.
        // Именно false, а не true: возвращённое из функции значение JointJS
        // берёт как готовую рамку и на `true` считает координаты из
        // несуществующих полей — узел уезжал в NaN, а сервер отбивал
        // сохранение позиции.
        return parent ? parent.getBBox().toJSON() : false;
      },
      // Линия начинается на границе узла, а не в его середине. Иначе путь
      // кабеля уходит внутрь карточки, и подписи портов, отмеряемые от его
      // начала, оказываются под ней.
      defaultConnectionPoint: { name: 'boundary', args: { offset: 2 } },
      interactive: (cellView) => {
        if (!canEdit) return false;
        // Заглушку свободного конца не двигают: за неё тянут кабель, и жест
        // не должен быть двусмысленным.
        if (cellView.model.get('kind') === 'stub') return { elementMove: false };
        return { linkMove: false, labelMove: false };
      },
    });
    element.appendChild(paper.el);
    paper.unfreeze();

    const observer = new ResizeObserver(() => {
      paper.setDimensions(Math.max(element.clientWidth, 320), Math.max(element.clientHeight, 320));
    });
    observer.observe(element);

    // Рамка выделения: рисуется поверх полотна обычным div'ом, а не ячейкой
    // графа — она не часть схемы и не должна попадать ни в поиск по области,
    // ни в подгонку масштаба.
    element.style.position = element.style.position || 'relative';
    const band = document.createElement('div');
    band.style.cssText = 'position:absolute;display:none;pointer-events:none;z-index:5;'
      + 'border:1px solid #1971c2;background:rgba(25,113,194,0.12);border-radius:3px';
    element.appendChild(band);

    let bandFrom: { x: number; y: number } | null = null;
    const drawBand = (to: { x: number; y: number }) => {
      if (!bandFrom) return;
      const a = paper.localToClientPoint(bandFrom);
      const b = paper.localToClientPoint(to);
      const host = element.getBoundingClientRect();
      band.style.display = 'block';
      band.style.left = `${Math.min(a.x, b.x) - host.left}px`;
      band.style.top = `${Math.min(a.y, b.y) - host.top}px`;
      band.style.width = `${Math.abs(a.x - b.x)}px`;
      band.style.height = `${Math.abs(a.y - b.y)}px`;
    };

    // Панорама — только средней кнопкой, и одинаково по пустому месту и по
    // объектам: схему таскают, когда её рассматривают, а рассматривают и
    // поверх узлов тоже. Левая за пустое место теперь сразу даёт рамку
    // выделения — Shift для неё больше не нужен.
    const MIDDLE = 1;
    let panning: { x: number; y: number } | null = null;
    const startPan = (event: dia.Event) => {
      panning = { x: event.clientX ?? 0, y: event.clientY ?? 0 };
    };

    paper.on('blank:pointerdown', (event: dia.Event, x: number, y: number) => {
      if (event.button === MIDDLE) { startPan(event); return; }
      if (!canEdit) return;
      bandFrom = { x, y };
      drawBand({ x, y });
    });
    // Средней кнопкой тянут и за объект: для навигации безразлично, что
    // оказалось под курсором.
    paper.on('cell:pointerdown', (_view: dia.CellView, event: dia.Event) => {
      if (event.button === MIDDLE) startPan(event);
    });
    paper.on('blank:pointermove', (_event: dia.Event, x: number, y: number) => {
      if (bandFrom) drawBand({ x, y });
    });
    paper.on('blank:pointerup', (_event: dia.Event, x: number, y: number) => {
      if (!bandFrom) return;
      band.style.display = 'none';
      const area = new g.Rect(
        Math.min(bandFrom.x, x), Math.min(bandFrom.y, y),
        Math.abs(bandFrom.x - x), Math.abs(bandFrom.y - y),
      );
      bandFrom = null;
      // Рамка в один пиксель — это промах мимо, а не выделение пустоты.
      if (area.width < 5 && area.height < 5) return;

      const caught = graph.findElementsInArea(area);
      const next = emptyMarked();
      for (const cell of caught) {
        if (cell.get('kind') === 'group') next.groups.add(cell.get('groupId') as number);
      }
      // Устройство, попавшее в захваченную группу, отдельно не отмечается:
      // двигая группу, её содержимое едет само, и пометить его вторично
      // значило бы сдвинуть дважды. По той же причине не отмечаются и
      // вложенные рамки захваченной группы.
      const insideCaughtGroup = (cell: dia.Cell) => {
        for (let at = cell.getParentCell(); at; at = at.getParentCell()) {
          if (at.get('kind') === 'group' && next.groups.has(at.get('groupId'))) return true;
        }
        return false;
      };
      for (const cell of caught) {
        if (insideCaughtGroup(cell)) continue;
        if (cell.get('kind') === 'device') next.devices.add(cell.get('deviceId') as number);
      }
      for (const groupId of [...next.groups]) {
        const cell = caught.find((c) => c.get('kind') === 'group' && c.get('groupId') === groupId);
        if (cell && insideCaughtGroup(cell)) next.groups.delete(groupId);
      }

      marked.current = next;
      setMarkedCount(markedSize(next));
      selection.current = null;
      showToolsRef.current(paper, null);
    });
    paper.on('blank:pointermove cell:pointermove', (event: dia.Event) => {
      if (!panning) return;
      const t = paper.translate();
      paper.translate(t.tx + ((event.clientX ?? 0) - panning.x), t.ty + ((event.clientY ?? 0) - panning.y));
      panning = { x: event.clientX ?? 0, y: event.clientY ?? 0 };
    });
    paper.on('blank:pointerup cell:pointerup', () => { panning = null; });

    // Правая кнопка — меню объекта. Само меню рисует страница: это обычная
    // разметка, и жить ей полагается рядом с окнами, которые открывают её
    // пункты, а не внутри полотна.
    const openMenu = (target: Selection, event: dia.Event) => {
      setMenu({ target, x: event.clientX ?? 0, y: event.clientY ?? 0 });
    };
    paper.on('element:contextmenu', (view: dia.ElementView, event: dia.Event) => {
      const kind = view.model.get('kind');
      const target: Selection = kind === 'device' ? { kind: 'device', id: view.model.get('deviceId') }
        : kind === 'group' ? { kind: 'group', id: view.model.get('groupId') }
          : null;
      if (!target) return;
      // Меню открывается по тому, на чём стоит курсор, — и это же становится
      // выделенным: иначе пункты меню относились бы к одному объекту, а
      // подсветка показывала другой.
      selection.current = target;
      marked.current = emptyMarked();
      setMarkedCount(0);
      showToolsRef.current(paper, target);
      openMenu(target, event);
    });
    paper.on('blank:contextmenu', (event: dia.Event) => openMenu(null, event));
    // Своё меню браузера поверх нашего не нужно.
    paper.el.addEventListener('contextmenu', (event: MouseEvent) => event.preventDefault());
    // Масштаб колесом — вокруг курсора, а не вокруг угла полотна. Иначе
    // при отдалении схема уезжает в левый верхний угол, и то место, куда
    // человек смотрел, приходится искать заново.
    paper.on('blank:mousewheel cell:mousewheel', (...args: unknown[]) => {
      const delta = args[args.length - 1] as number;
      const y = args[args.length - 2] as number;
      const x = args[args.length - 3] as number;
      const from = paper.scale().sx;
      // Нижняя граница — пять процентов: на тысяче устройств схема шире
      // экрана в разы, и прежние двадцать процентов не давали увидеть её
      // целиком. Верхняя оставлена прежней: ближе двух с половиной крат
      // рассматривать на карточке уже нечего.
      const to = Math.min(2.5, Math.max(0.05, from * (delta > 0 ? 1.1 : 0.9)));
      if (to === from) return;
      const t = paper.translate();
      // Экранная точка под курсором до масштабирования — после него она
      // должна остаться там же.
      const screenX = x * from + t.tx;
      const screenY = y * from + t.ty;
      paper.scale(to);
      paper.translate(screenX - x * to, screenY - y * to);
    });
    // Масштаб изменился — панель действий пересобирается с новой поправкой.
    paper.on('scale', () => showToolsRef.current(paper, selection.current));

    // Выделение по клику левой кнопкой.
    paper.on('element:pointerclick', (view: dia.ElementView, event: dia.Event) => {
      const model = view.model;
      const kind = model.get('kind');

      // Режим протягивания кабеля: пункт меню его включил, и этот щелчок —
      // выбор второго конца. Тянуть мышью от кнопки, как раньше, больше
      // неоткуда: кнопок на полотне не осталось, а жест мышью пунктом меню
      // не сделаешь — поэтому связь набирается двумя щелчками.
      const from = connectFromRef.current;
      if (from != null) {
        setConnectFrom(null);
        if (kind !== 'device') return;
        const source = graph.getElements().find(
          (el) => el.get('kind') === 'device' && el.get('deviceId') === from,
        );
        const target = model as dia.Element;
        if (source && source !== target) handlers.current.onConnect(source, target);
        return;
      }

      // Shift по узлу или рамке добавляет их к выделенным рамкой или
      // убирает — дособрать пачку из разных углов схемы иначе нечем.
      if (canEdit && event.shiftKey && (kind === 'device' || kind === 'group')) {
        const set = kind === 'device' ? marked.current.devices : marked.current.groups;
        const id = (kind === 'device' ? model.get('deviceId') : model.get('groupId')) as number;
        if (set.has(id)) set.delete(id);
        else set.add(id);
        setMarkedCount(markedSize(marked.current));
        selection.current = null;
        showToolsRef.current(paper, null);
        return;
      }
      // Обычный щелчок — работа с одним объектом, и пачка при этом
      // снимается: иначе Delete удалил бы заодно то, о чём человек уже забыл.
      if (markedSize(marked.current)) {
        marked.current = emptyMarked();
        setMarkedCount(0);
      }
      selection.current = kind === 'device' ? { kind: 'device', id: model.get('deviceId') }
        : kind === 'group' ? { kind: 'group', id: model.get('groupId') }
          : null;
      showToolsRef.current(paper, selection.current);
    });
    paper.on('blank:pointerclick', () => {
      // Щелчок по пустому месту выключает режим протягивания: человек
      // передумал.
      if (connectFromRef.current != null) setConnectFrom(null);
      if (markedSize(marked.current)) {
        marked.current = emptyMarked();
        setMarkedCount(0);
      }
      selection.current = null;
      showToolsRef.current(paper, null);
    });
    paper.on('link:pointerclick', (view: dia.LinkView) => {
      const linkId = view.model.get('linkId');
      if (linkId) handlers.current.onLinkClick(linkId);
    });

    // Подписи портов в режиме «при наведении»: они и так есть в модели
    // линии (иначе показывать по наведению было бы нечего), просто с
    // самого начала прозрачные — `hoverLabels` их и отмечает. Кабели, для
    // которых подписи включены всегда или выключены совсем, эту метку не
    // несут и здесь не участвуют.
    const setLinkLabelsVisible = (link: dia.Link, visible: boolean) => {
      const opacity = visible ? 1 : 0;
      link.labels().forEach((_, index) => {
        link.label(index, {
          attrs: {
            labelBody: { opacity, pointerEvents: visible ? 'auto' : 'none' },
            labelText: { opacity },
          },
        });
      });
    };
    paper.on('link:mouseenter', (view: dia.LinkView) => {
      if (view.model.get('hoverLabels')) setLinkLabelsVisible(view.model, true);
    });
    paper.on('link:mouseleave', (view: dia.LinkView) => {
      if (view.model.get('hoverLabels')) setLinkLabelsVisible(view.model, false);
    });

    // Перетаскивание пачкой: тянут за одну из выделенных карточек, едут все.
    // Остальные двигаются вслед за ведущей на тот же сдвиг — своими
    // событиями мыши они не управляются, поэтому их положение меняется прямо.
    let lead: { id: string; at: g.Point; others: Map<string, g.Point> } | null = null;
    /** Выделен ли рамкой этот узел или эта рамка. */
    const isMarked = (element: dia.Element) => {
      const kind = element.get('kind');
      if (kind === 'device') return marked.current.devices.has(element.get('deviceId'));
      if (kind === 'group') return marked.current.groups.has(element.get('groupId'));
      return false;
    };
    paper.on('element:pointerdown', (view: dia.ElementView, event: dia.Event) => {
      lead = null;
      if (!canEdit || event.button === MIDDLE) return;
      if (!isMarked(view.model)) return;
      const others = new Map<string, g.Point>();
      for (const element of graph.getElements()) {
        if (element === view.model || !isMarked(element)) continue;
        // Содержимое выделенной рамки едет за ней само — вести его отдельно
        // значило бы сдвинуть дважды.
        let inside = false;
        for (let at = element.getParentCell(); at; at = at.getParentCell()) {
          if (at === view.model || isMarked(at as dia.Element)) { inside = true; break; }
        }
        if (inside) continue;
        others.set(String(element.id), element.position().clone());
      }
      lead = { id: String(view.model.id), at: view.model.position().clone(), others };
    });
    graph.on('change:position', (cell: dia.Cell) => {
      if (!lead || String(cell.id) !== lead.id) return;
      const now = (cell as dia.Element).position();
      const dx = now.x - lead.at.x;
      const dy = now.y - lead.at.y;
      for (const [id, start] of lead.others) {
        const element = graph.getCell(id) as dia.Element | undefined;
        if (!element) continue;
        if (element.get('kind') === 'group') {
          // Рамка едет со всем, что внутри: `deep` переносит и вложенные
          // ячейки, иначе содержимое осталось бы на месте, а рамка уехала.
          element.position(start.x + dx, start.y + dy, { deep: true });
          continue;
        }
        // Ведомые узлы подрезаются рамкой своей группы прямо на ходу. Полотно
        // само это делает только для того узла, за который тянут; без
        // подрезки остальные выезжали за рамку, а при следующей перерисовке
        // возвращались в неё — узлы прыгали как будто сами по себе.
        const at = insideParent(element, start.x + dx, start.y + dy);
        // Своё же событие сюда вернётся, но с чужим id и отсеется первой
        // строкой — рекурсии нет, а вид обновляется как обычно.
        element.position(at.x, at.y);
      }
    });

    // Перетащили — сохраняем: устройство своей позицией, рамку — своей.
    paper.on('element:pointerup', (view: dia.ElementView) => {
      if (!canEdit) return;
      const model = view.model;
      const moves: { id: number; x: number; y: number }[] = [];
      const frames: { id: number; box: Box }[] = [];
      const remember = (element: dia.Element) => {
        const center = element.getBBox().center();
        moves.push({ id: element.get('deviceId'), x: center.x, y: center.y });
      };
      const rememberFrame = (element: dia.Element) => {
        const box = element.getBBox();
        frames.push({
          id: element.get('groupId'),
          box: { x: box.x, y: box.y, width: box.width, height: box.height },
        });
      };

      /** Записать ячейку и всё, что уехало вместе с ней. */
      const rememberDeep = (element: dia.Element) => {
        if (element.get('kind') === 'device') { remember(element); return; }
        if (element.get('kind') !== 'group') return;
        rememberFrame(element);
        // Содержимое уехало вместе с рамкой — его новое положение тоже нужно
        // записать: в базе координаты абсолютные. Это касается и подгрупп:
        // их рамки хранятся своими, и без записи они возвращались на прежнее
        // место, стоило отпустить мышь.
        for (const child of element.getEmbeddedCells({ deep: true })) {
          if (child.get('kind') === 'device') remember(child as dia.Element);
          else if (child.get('kind') === 'group') rememberFrame(child as dia.Element);
        }
      };

      if (lead && String(model.id) === lead.id) {
        for (const id of lead.others.keys()) {
          const element = graph.getCell(id) as dia.Element | undefined;
          if (element) rememberDeep(element);
        }
        lead = null;
      }
      if (model.get('kind') === 'device') {
        remember(model as dia.Element);
      } else if (model.get('kind') === 'group') {
        rememberFrame(model as dia.Element);
        // Содержимое уехало вместе с рамкой — его новое положение тоже нужно
        // записать: в базе координаты абсолютные. Это касается и подгрупп:
        // их рамки хранятся своими, и без записи они возвращались на прежнее
        // место, стоило отпустить мышь.
        for (const child of model.getEmbeddedCells({ deep: true })) {
          if (child.get('kind') === 'device') remember(child as dia.Element);
          else if (child.get('kind') === 'group') rememberFrame(child as dia.Element);
        }
      }
      if (moves.length) handlers.current.onDevicesMoved(moves);
      if (frames.length) handlers.current.onGroupsMoved(frames);
    });

    // Растянули рамку за угол. Размер меняется на каждое движение мыши, а
    // записывать его на каждый пиксель — сотня запросов на одно движение;
    // поэтому сохраняем, когда рука остановилась.
    let resizeTimer: number | undefined;
    graph.on('change:size', (cell: dia.Cell) => {
      if (!canEdit || cell.get('kind') !== 'group') return;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const box = (cell as dia.Element).getBBox();
        handlers.current.onGroupsMoved([{
          id: cell.get('groupId'),
          box: { x: box.x, y: box.y, width: box.width, height: box.height },
        }]);
      }, 350);
    });

    // Протянули кабель: временная линия не остаётся на схеме — вместо неё
    // открывается окно выбора портов, а связь создаёт сервер.
    paper.on('link:connect', (linkView: dia.LinkView) => {
      const source = linkView.model.getSourceCell() as dia.Element | null;
      const target = linkView.model.getTargetCell() as dia.Element | null;
      linkView.model.remove();
      if (source && target) handlers.current.onConnect(source, target);
    });

    paperRef.current = paper;
    graphRef.current = graph;
    return () => {
      window.clearTimeout(resizeTimer);
      observer.disconnect();
      paper.remove();
      paperRef.current = null;
      graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);

  // Фон полотна меняется настройкой вида и темой интерфейса, а полотно
  // создаётся один раз.
  useEffect(() => {
    paperRef.current?.setGrid(gridFor(background, scheme));
  }, [background, scheme]);

  // Delete удаляет выделенное, Escape выключает режим протягивания кабеля и
  // закрывает меню — то и другое иначе снимается только мышью.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const active = document.activeElement;
      const typing = active != null && ['INPUT', 'TEXTAREA'].includes(active.tagName);
      if (event.key === 'Escape') {
        setConnectFrom(null);
        setMenu(null);
        return;
      }
      if (!canEdit || typing) return;
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      handlers.current.onDelete(selection.current, marked.current);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);

  return {
    holder, paperRef, graphRef, selection, marked, markedCount, clearMarked, refreshTools,
    menu, closeMenu, connectFrom, startConnect, cancelConnect,
  };
}
