import { createContext, useContext } from 'react';

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

  /** Вторая строка узла — название устройства под кодом. */
  deviceSubtitle: boolean;
  /** Счётчик «занято/всего» портов. */
  devicePorts: boolean;
  /** Цветное свечение вокруг узла. Без него схема суше, но спокойнее. */
  deviceGlow: boolean;

  edgeWidth: number;
  /** Подписи портов на концах линии. */
  edgeLabels: boolean;
  /** Название порта в подписи рядом с номером. Номер остаётся всегда: это
   * то, чем порт опознают на железке. */
  edgeLabelName: boolean;

  background: 'dots' | 'lines' | 'cross' | 'none';
  minimap: boolean;
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

  edgeWidth: 2,
  edgeLabels: true,
  edgeLabelName: true,

  background: 'dots',
  minimap: true,
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

export const TopologyAppearanceContext = createContext<TopologyAppearance>(DEFAULT_APPEARANCE);

export function useAppearance(): TopologyAppearance {
  return useContext(TopologyAppearanceContext);
}

/** Цвет с прозрачностью. `color-mix` берёт любую запись цвета — и hex из
 * справочника, и переменную темы, — в отличие от склейки hex + альфа. */
export function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}
