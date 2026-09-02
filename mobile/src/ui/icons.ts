/**
 * Иконки — Feather.
 *
 * На сайте это Tabler, а Tabler вырос из Feather: та же сетка 24, та же
 * толщина обводки, те же скруглённые концы. Ближе к вебу здесь ничего нет,
 * а набор Material выглядел бы другим продуктом рядом с сайтом.
 *
 * Импорт идёт из подпути, а не из `@expo/vector-icons`: корневой модуль
 * тянет за собой шрифты всех пятнадцати наборов, и все они уезжают в APK.
 */

import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';

export { Feather };

/** Имена — строковый union: опечатка в иконке падает на проверке типов, а не
 * пустым квадратом на телефоне. */
export type IconName = ComponentProps<typeof Feather>['name'];

/** Размеры те же, что на сайте: 14 в плотных строках, 16 в кнопках,
 * 18 у заголовков строк, 22 в панели разделов. */
export const ICON = { xs: 14, sm: 16, md: 18, lg: 20, tab: 22 } as const;
