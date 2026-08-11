import { useCallback, useEffect, useRef } from 'react';
import { dia, highlighters, shapes } from '@joint/core';
import { canvasColors, loadAppearance, type TopologyAppearance } from '../appearance';
import { deviceTools, groupTools } from './tools';
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
 */

export type Selection = { kind: 'device' | 'group'; id: number } | null;

/** Что панель действий умеет делать с узлом и с рамкой. */
export interface JointActions {
  edit: (deviceId: number) => void;
  copy: (deviceId: number) => void;
  regroup: (deviceId: number) => void;
  remove: (deviceId: number) => void;
  editGroup: (groupId: number) => void;
  addSubgroup: (groupId: number) => void;
  removeGroup: (groupId: number) => void;
}

/** Что полотно сообщает странице. */
export interface PaperHandlers {
  /** Протянули кабель от одной ячейки к другой. */
  onConnect: (source: dia.Element, target: dia.Element) => void;
  onLinkClick: (linkId: number) => void;
  onDeviceMoved: (deviceId: number, x: number, y: number) => void;
  onGroupMoved: (groupId: number, box: Box) => void;
  onDelete: (selection: Selection) => void;
}

export interface JointPaper {
  /** Контейнер под полотно — вешается на `<div ref=…>`. */
  holder: React.RefObject<HTMLDivElement | null>;
  paperRef: React.RefObject<dia.Paper | null>;
  graphRef: React.RefObject<dia.Graph | null>;
  selection: React.RefObject<Selection>;
  /** Перерисовать панель действий у выделенного. Нужно после наполнения
   * графа: ячейки создаются заново, а выделенным остаётся то же устройство. */
  refreshTools: () => void;
}

/** Фон полотна из настроек вида — своими именами JointJS. */
const GRID: Record<TopologyAppearance['background'], dia.Paper.GridOptions | false> = {
  dots: { name: 'dot', color: '#ced4da', thickness: 1 },
  lines: { name: 'mesh', color: '#e9ecef', thickness: 1 },
  cross: { name: 'doubleMesh', color: '#e9ecef', thickness: 1 },
  none: false,
};

export function useJointPaper({ canEdit, scheme, background, actions, handlers }: {
  canEdit: boolean;
  scheme: 'light' | 'dark';
  background: TopologyAppearance['background'];
  actions: React.RefObject<JointActions>;
  handlers: React.RefObject<PaperHandlers>;
}): JointPaper {
  const holder = useRef<HTMLDivElement>(null);
  const paperRef = useRef<dia.Paper | null>(null);
  const graphRef = useRef<dia.Graph | null>(null);
  const selection = useRef<Selection>(null);

  /** Панели действий берут обработчики в момент нажатия — так в них не
   * застывает состояние того рендера, на котором рисовали узел. */
  const toolActions = useCallback((): JointActions => ({
    edit: (id) => actions.current.edit(id),
    copy: (id) => actions.current.copy(id),
    regroup: (id) => actions.current.regroup(id),
    remove: (id) => actions.current.remove(id),
    editGroup: (id) => actions.current.editGroup(id),
    addSubgroup: (id) => actions.current.addSubgroup(id),
    removeGroup: (id) => actions.current.removeGroup(id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  /** Показать панель действий и подсветку у выделенного. */
  const showTools = useCallback((paper: dia.Paper, target: Selection) => {
    // Кнопки живут в координатах схемы: отдалили её — и попасть в них нечем.
    // Поправка возвращает им экранный размер, но только при отдалении: при
    // приближении кнопки растут вместе с узлом, и это никому не мешает.
    const look = {
      paint: canvasColors(scheme),
      zoom: Math.min(Math.max(1 / paper.scale().sx, 1), 4),
    };
    paper.removeTools();
    highlighters.stroke.removeAll(paper);
    if (!target) return;
    const key = target.kind === 'device' ? 'deviceId' : 'groupId';
    const cell = paper.model.getElements().find(
      (el) => el.get('kind') === target.kind && el.get(key) === target.id,
    );
    const view = cell?.findView(paper) as dia.ElementView | undefined;
    if (!cell || !view) return;
    if (target.kind === 'device') {
      highlighters.stroke.add(view, 'body', 'selected', {
        padding: 3, rx: 12, ry: 12, attrs: { stroke: '#1971c2', 'stroke-width': 2 },
      });
      if (canEdit) view.addTools(deviceTools(target.id, toolActions(), look));
    } else if (canEdit) {
      view.addTools(groupTools(target.id, toolActions(), cell.get('accent') ?? '#4dabf7', look));
    }
  }, [canEdit, scheme, toolActions]);

  /** Обработчики полотна ставятся один раз, а показ панели зависит от темы
   * и масштаба — поэтому он берётся через ссылку, а не замыкается. */
  const showToolsRef = useRef(showTools);
  showToolsRef.current = showTools;

  const refreshTools = useCallback(() => {
    const paper = paperRef.current;
    if (paper) showToolsRef.current(paper, selection.current);
  }, []);

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
      drawGrid: GRID[loadAppearance().background],
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

    // Панорама тягой за пустое место, масштаб колесом.
    let panning: { x: number; y: number } | null = null;
    paper.on('blank:pointerdown', (event: dia.Event) => {
      panning = { x: event.clientX ?? 0, y: event.clientY ?? 0 };
    });
    paper.on('blank:pointermove cell:pointermove', (event: dia.Event) => {
      if (!panning) return;
      const t = paper.translate();
      paper.translate(t.tx + ((event.clientX ?? 0) - panning.x), t.ty + ((event.clientY ?? 0) - panning.y));
      panning = { x: event.clientX ?? 0, y: event.clientY ?? 0 };
    });
    paper.on('blank:pointerup cell:pointerup', () => { panning = null; });
    // Масштаб колесом — вокруг курсора, а не вокруг угла полотна. Иначе
    // при отдалении схема уезжает в левый верхний угол, и то место, куда
    // человек смотрел, приходится искать заново.
    paper.on('blank:mousewheel cell:mousewheel', (...args: unknown[]) => {
      const delta = args[args.length - 1] as number;
      const y = args[args.length - 2] as number;
      const x = args[args.length - 3] as number;
      const from = paper.scale().sx;
      const to = Math.min(2.5, Math.max(0.2, from * (delta > 0 ? 1.1 : 0.9)));
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

    // Выделение: панель действий появляется по клику.
    paper.on('element:pointerclick', (view: dia.ElementView) => {
      const model = view.model;
      const kind = model.get('kind');
      selection.current = kind === 'device' ? { kind: 'device', id: model.get('deviceId') }
        : kind === 'group' ? { kind: 'group', id: model.get('groupId') }
          : null;
      showToolsRef.current(paper, selection.current);
    });
    paper.on('blank:pointerclick', () => {
      selection.current = null;
      showToolsRef.current(paper, null);
    });
    paper.on('link:pointerclick', (view: dia.LinkView) => {
      const linkId = view.model.get('linkId');
      if (linkId) handlers.current.onLinkClick(linkId);
    });

    // Перетащили — сохраняем: устройство своей позицией, рамку — своей.
    paper.on('element:pointerup', (view: dia.ElementView) => {
      if (!canEdit) return;
      const model = view.model;
      if (model.get('kind') === 'device') {
        const center = model.getBBox().center();
        handlers.current.onDeviceMoved(model.get('deviceId'), center.x, center.y);
      } else if (model.get('kind') === 'group') {
        const box = model.getBBox();
        handlers.current.onGroupMoved(model.get('groupId'), {
          x: box.x, y: box.y, width: box.width, height: box.height,
        });
        // Содержимое уехало вместе с рамкой — его новые координаты тоже нужно
        // записать: в базе они абсолютные.
        for (const child of model.getEmbeddedCells({ deep: true })) {
          if (child.get('kind') !== 'device') continue;
          const at = (child as dia.Element).getBBox().center();
          handlers.current.onDeviceMoved(child.get('deviceId'), at.x, at.y);
        }
      }
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
        handlers.current.onGroupMoved(cell.get('groupId'), {
          x: box.x, y: box.y, width: box.width, height: box.height,
        });
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

  // Фон полотна меняется настройкой вида, а полотно создаётся один раз.
  useEffect(() => {
    paperRef.current?.setGrid(GRID[background]);
  }, [background]);

  // Delete удаляет выделенное.
  useEffect(() => {
    if (!canEdit) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const active = document.activeElement;
      if (active && ['INPUT', 'TEXTAREA'].includes(active.tagName)) return;
      handlers.current.onDelete(selection.current);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);

  return { holder, paperRef, graphRef, selection, refreshTools };
}
