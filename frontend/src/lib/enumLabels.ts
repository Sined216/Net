/** Русские подписи для значений-перечислений, которые API отдаёт латиницей.
 *
 * Значение в базе и на проводе остаётся английским (`access`, `manual`...)
 * — это протокольная договорённость, менять её ради интерфейса незачем.
 * Но показывать эти же слова человеку в остальном русском интерфейсе —
 * непоследовательно: у разъёмов (`CatalogPage.mediaLabel`) для той же идеи
 * «медь/оптика» давно есть русский словарь, а связи, порты и роль
 * устройства показывали свои перечисления как есть. Здесь — тот же приём,
 * собранный в одном месте, чтобы не заводить словарь заново в каждом файле.
 */

import type { DeviceRole, LineStyle, LinkOut, MediaType, PortMode } from '../api/types';

export const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
  copper: 'медь',
  fiber: 'оптика',
  wireless: 'беспроводная',
  dac: 'DAC',
  other: 'прочее',
};

export function mediaTypeLabel(value: MediaType): string {
  return MEDIA_TYPE_LABELS[value] ?? value;
}

export const LINE_STYLE_LABELS: Record<LineStyle, string> = {
  solid: 'сплошная',
  dashed: 'пунктирная',
  dotted: 'точечная',
};

export function lineStyleLabel(value: LineStyle): string {
  return LINE_STYLE_LABELS[value] ?? value;
}

export const PORT_MODE_LABELS: Record<PortMode, string> = {
  access: 'доступ',
  trunk: 'транк',
  uplink: 'аплинк',
};

export function portModeLabel(value: PortMode): string {
  return PORT_MODE_LABELS[value] ?? value;
}

export const DEVICE_ROLE_LABELS: Record<DeviceRole, string> = {
  core: 'ядро',
  distribution: 'распределение',
  access: 'доступ',
};

export function deviceRoleLabel(value: DeviceRole): string {
  return DEVICE_ROLE_LABELS[value] ?? value;
}

type LinkSource = LinkOut['source'];

export const LINK_SOURCE_LABELS: Record<LinkSource, string> = {
  // SNMP и LLDP — протоколы, у них нет русского имени, которое кто-то бы
  // узнал быстрее аббревиатуры; переводится только «руками».
  manual: 'вручную',
  snmp: 'SNMP',
  lldp: 'LLDP',
};

export function linkSourceLabel(value: LinkSource): string {
  return LINK_SOURCE_LABELS[value] ?? value;
}
