/**
 * Типы обмена с WireMap — те же, что у сайта.
 *
 * Выводятся из `schema.ts`, который генерируется из описания API самого
 * бэкенда (`npm run codegen`), — как и во `frontend/src/api/types.ts`.
 * Руками ничего не переписывается: иначе телефон и сервер разъезжаются
 * молча, и узнаётся это уже в цеху, где чинить нечем.
 */

import type { components } from './schema';

type S = components['schemas'];

export type SyncSnapshot = S['SyncSnapshot'];
export type SyncUploadRequest = S['SyncUploadRequest'];
export type SyncUploadResult = S['SyncUploadResult'];
export type SyncDeviceIn = S['SyncDeviceIn'];
export type SyncLinkIn = S['SyncLinkIn'];

export type DeviceOut = S['DeviceOut'];
export type InterfaceOut = S['InterfaceOut'];
export type LinkOut = S['LinkOut'];
export type DeviceTemplateOut = S['DeviceTemplateOut'];
export type DeviceTypeOut = S['DeviceTypeOut'];
export type SiteOut = S['SiteOut'];
export type Token = S['Token'];
