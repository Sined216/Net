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

  /** Вторая строка узла — код устройства под названием. */
  deviceSubtitle: boolean;
  /** Счётчик «занято/всего» портов. */
  devicePorts: boolean;
  /** Цветное свечение вокруг узла. Без него схема суше, но спокойнее. */
  deviceGlow: boolean;
  /** Тёмная карточка узла. На светлом полотне цветная рамка модели читается
   * заметно лучше, чем на белом узле, — ради этого вид и задумывался. */
  deviceDark: boolean;

  /** Как разводить кабели: ортогонально (обходя узлы) или прямыми линиями.
   * Настройка вида, а не состояние экрана: выбранный однажды способ должен
   * пережить перезагрузку, как и всё остальное здесь. */
  edgeRouter: 'orthogonal' | 'straight';
  edgeWidth: number;
  /** Подписи портов на концах линии. */
  edgeLabels: boolean;
  /** Название порта в подписи рядом с номером. Номер остаётся всегда: это
   * то, чем порт опознают на железке. */
  edgeLabelName: boolean;

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
  devicePorts: true,
  deviceGlow: true,
  deviceDark: true,

  edgeRouter: 'orthogonal',
  edgeWidth: 2,
  edgeLabels: true,
  edgeLabelName: true,

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
    const saved = JSON.parse(raw) as Partial<TopologyAppearance>;
    return { ...DEFAULT_APPEARANCE, ...saved };
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
    fill: scheme === 'dark' ? '#25262b' : '#1a1b1e',
    title: '#f8f9fa',
    subtitle: '#909296',
    portsIdle: '#909296',
    portsBusy: '#38d9a9',
  };
}

export type ColorScheme = 'light' | 'dark';

/** Цвета того, что лежит на полотне поверх линий: подписи портов, врезка
 * подписи группы, кнопки панелей. Своими значениями, а не переменными темы:
 * в атрибутах SVG переменные CSS работают не везде. */
export function canvasColors(scheme: ColorScheme) {
  const dark = scheme === 'dark';
  return {
    /** Фон полотна — им закрашивается врезка подписи группы. */
    canvas: dark ? '#1a1b1e' : '#ffffff',
    /** Подложка подписи и кнопки. */
    plate: dark ? '#2c2e33' : '#ffffff',
    plateBorder: dark ? '#5c5f66' : '#dee2e6',
    plateText: dark ? '#c1c2c5' : '#495057',
    /** Значок на кнопке панели. */
    icon: dark ? '#c1c2c5' : '#495057',
  };
}
