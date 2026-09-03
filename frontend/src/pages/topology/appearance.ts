import type { ElkAlgorithm } from '../../lib/elk';
import { CANVAS } from '../../theme';

/** Внешний вид схемы связей.
 *
 * Настройка личная и лежит в браузере, а не в базе: это вкус, а не данные.
 * Двое смотрят на одну и ту же схему по-разному — один любит плотную
 * заливку групп, другому она мешает читать подписи, — и навязывать общий
 * выбор здесь незачем.
 */
export interface TopologyAppearance {
  /** Линия рамки группы. `none` — только заливка, без контура. */
  groupBorder: 'solid' | 'dashed' | 'dotted' | 'none';
  groupBorderWidth: number;
  groupRadius: number;
  /** Плотность заливки рамки, проценты. 0 — прозрачная. */
  groupFill: number;
  /** Где подпись группы: врезкой в рамку, внутри неё или нигде. */
  groupTitle: 'onFrame' | 'inside' | 'hidden';
  /** Показывать число устройств рядом с названием группы. */
  groupCount: boolean;

  /** Строки под названием. Каждая — своя, потому что нужны они разным
   * людям: снабженцу важна фирма и модель, наладчику — код на наклейке.
   * Карточка растёт и сжимается по числу включённых строк. */
  deviceSubtitle: boolean;      // код устройства
  /** Адрес управления. Наладчику он нужен, чтобы зайти на железку прямо со
   * схемы; снабженцу — никогда, поэтому и включается отдельно. */
  deviceIp: boolean;
  deviceTemplate: boolean;      // название модели
  deviceManufacturer: boolean;  // фирма-изготовитель
  /** Счётчик «занято/всего» портов. */
  devicePorts: boolean;
  /** Размер и жирность названия и строк под ним. Вкус, а не смысл: одному
   * нужен плакат на стену, другому — плотная схема на весь цех. */
  deviceTitleSize: number;
  deviceTitleWeight: number;
  deviceLineSize: number;
  deviceLineWeight: number;
  /** Цветное свечение вокруг узла. Без него схема суше, но спокойнее. */
  deviceGlow: boolean;
  /** Тёмная карточка узла. На светлом полотне цветная рамка модели читается
   * заметно лучше, чем на белом узле, — ради этого вид и задумывался. */
  deviceDark: boolean;

  edgeWidth: number;
  /** Как кабель ищет путь между карточками. `normal` — отрезок напрямую;
   * `manhattan` и `metro` ведут его прямыми углами в обход чужих узлов
   * (второй позволяет себе диагонали), `rightAngle` — прямыми углами, но
   * не обходя ничего, по одним отступам. Чем плотнее схема, тем сильнее
   * расходятся эти способы: на десятке узлов прямая читается лучше всего,
   * на сотне она превращается в паутину поверх карточек. */
  edgeRouter: 'normal' | 'manhattan' | 'metro' | 'rightAngle';
  /** Чем нарисован найденный путь. `rounded` скругляет углы маршрута — на
   * прямой разводке ему нечего скруглять; заметную кривизну там даёт
   * `curve`. `jumpover` — про другое: он рисует «мостик» в месте, где две
   * линии пересекаются, иначе они читаются как одна с ответвлением. */
  edgeConnector: 'normal' | 'rounded' | 'curve' | 'jumpover';
  /** Подписи портов на концах линии: всегда видны, появляются при
   * наведении на кабель, или не показываются вовсе. На плотной схеме
   * подписи всех кабелей разом читать так же трудно, как не иметь их —
   * они налезают друг на друга, и «при наведении» даёт то же самое
   * значение по требованию, не занимая место постоянно. */
  edgeLabels: 'always' | 'hover' | 'never';
  /** Название порта в подписи рядом с номером. Номер остаётся всегда: это
   * то, чем порт опознают на железке. */
  edgeLabelName: boolean;
  /** Размер подписи порта. */
  edgeLabelSize: number;
  /** Размер подписи группы. */
  groupTitleSize: number;

  /** Расстояние между рядами при автоматической раскладке («Разложить»).
   * Между рядами идут кабели с подписями портов — слишком тесно подписи
   * налезают друг на друга и на соседний ряд. */
  layoutRowGap: number;
  /** Расстояние между узлами внутри ряда при той же раскладке. */
  layoutNodeGap: number;
  /** Каким алгоритмом ELK раскладывать при «Разложить». Ровное дерево
   * заводской сети и плотная связка коммутаторов в одном шкафу просят
   * разное — какой лучше подходит именно этой сети, решает не код. */
  layoutAlgorithm: ElkAlgorithm;

  background: 'dots' | 'lines' | 'cross' | 'none';
}

export const DEFAULT_APPEARANCE: TopologyAppearance = {
  groupBorder: 'solid',
  groupBorderWidth: 1.5,
  groupRadius: 12,
  groupFill: 6,
  groupTitle: 'onFrame',
  groupCount: true,

  deviceSubtitle: true,
  deviceIp: false,
  deviceTemplate: false,
  deviceManufacturer: false,
  devicePorts: true,
  deviceTitleSize: 14,
  deviceTitleWeight: 500,
  deviceLineSize: 12,
  deviceLineWeight: 400,
  deviceGlow: true,
  deviceDark: true,

  edgeWidth: 2,
  edgeRouter: 'normal',
  edgeConnector: 'rounded',
  edgeLabels: 'always',
  edgeLabelName: true,
  edgeLabelSize: 10,
  groupTitleSize: 12,

  layoutRowGap: 120,
  layoutNodeGap: 44,
  layoutAlgorithm: 'layered',

  background: 'dots',
};

const STORAGE_KEY = 'netdoc.topology.appearance';

/** Прочитать настройки. Незнакомые и отсутствующие поля берутся из
 * умолчаний: настройки, сохранённые прошлой версией интерфейса, не должны
 * ронять страницу после обновления. */
export function loadAppearance(): TopologyAppearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const saved = JSON.parse(raw) as Partial<TopologyAppearance> & { edgeLabels?: unknown };
    // edgeLabels было булевым — прошлая настройка «включено» читается как
    // «всегда», «выключено» как «никогда»; третье, промежуточное значение
    // раньше было взять неоткуда.
    if (typeof saved.edgeLabels === 'boolean') {
      saved.edgeLabels = saved.edgeLabels ? 'always' : 'never';
    }
    return { ...DEFAULT_APPEARANCE, ...saved } as TopologyAppearance;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function saveAppearance(value: TopologyAppearance): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Приватный режим браузера запрещает запись — настройки просто не
    // переживут перезагрузку, но работать это не мешает.
  }
}

/** Цвет с прозрачностью. `color-mix` берёт любую запись цвета — и hex из
 * справочника, и переменную темы, — в отличие от склейки hex + альфа. */
export function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

/** Цвета карточки узла.
 *
 * Считаются от двух вещей сразу: от настройки «тёмная карточка» и от темы
 * интерфейса, потому что полотно схемы — это фон страницы. Тёмная карточка
 * цвета фона на тёмной теме просто растворилась бы в нём, поэтому там она
 * на ступень светлее полотна, а на светлой теме остаётся почти чёрной.
 */
export function nodeColors(dark: boolean, scheme: ColorScheme) {
  if (!dark) {
    return {
      fill: '#ffffff',
      title: '#212529',
      subtitle: '#868e96',
      portsIdle: '#868e96',
      portsBusy: '#0ca678',
    };
  }
  return {
    fill: scheme === 'dark' ? CANVAS.card : '#1a1b1e',
    title: '#f8f9fa',
    subtitle: '#909296',
    portsIdle: '#909296',
    portsBusy: '#38d9a9',
  };
}

export type ColorScheme = 'light' | 'dark';

/** Цвета того, что лежит на полотне поверх линий: подписи портов, врезка
 * подписи группы, кнопки панелей. Своими значениями, а не переменными темы:
 * в атрибутах SVG переменные CSS работают не везде. Сами значения берутся
 * из темы (`CANVAS`), а не пишутся здесь второй раз: разойтись им нельзя —
 * полотно это и есть фон страницы. */
export function canvasColors(scheme: ColorScheme) {
  const dark = scheme === 'dark';
  return {
    /** Фон полотна — им закрашивается врезка подписи группы. */
    canvas: dark ? CANVAS.background : '#ffffff',
    /** Подложка подписи и кнопки. */
    plate: dark ? CANVAS.surface : '#ffffff',
    plateBorder: dark ? CANVAS.border : '#dee2e6',
    plateText: dark ? '#c1c2c5' : '#495057',
    /** Значок на кнопке панели. */
    icon: dark ? '#c1c2c5' : '#495057',
  };
}
