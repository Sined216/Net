/**
 * Маршруты приложения.
 *
 * Разделов три, у каждого свой стек — чтобы уход в карточку устройства не
 * сбрасывал вкладку и обратно человек возвращался туда, где был.
 */

import type { NavigatorScreenParams } from '@react-navigation/native';

/**
 * Экраны добавления записаны в двух стеках сразу: находку заводят и из
 * спецификации («тут стоит что-то незаписанное»), и из списка найденного
 * («допишу ещё одно»). Отдельным стеком поверх вкладок их делать нельзя —
 * он прячет панель разделов, а она нужна именно во время заполнения: видеть
 * счётчик несданных находок.
 *
 * Экраны эти умеют только `goBack()`, поэтому одинаково работают под любым
 * из хозяев — типизируются этим общим списком.
 */
export type AddRoutes = {
  AddDevice: undefined;
  /** Конец A подставляется, когда экран открыт от гнезда в карточке. */
  AddLink: { aDeviceId?: number; aDeviceText?: string; aPortText?: string };
};

export type SpecStackParams = AddRoutes & {
  Devices: undefined;
  Device: { id: number };
};

export type QueueStackParams = AddRoutes & {
  Queue: undefined;
};

export type SyncStackParams = {
  Sync: undefined;
  Connection: undefined;
};

export type TabParams = {
  SpecTab: NavigatorScreenParams<SpecStackParams>;
  QueueTab: NavigatorScreenParams<QueueStackParams>;
  SyncTab: NavigatorScreenParams<SyncStackParams>;
};
