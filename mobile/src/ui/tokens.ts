/**
 * Цвета и размеры — те же, что у сайта.
 *
 * Веб-версия WireMap собрана на стоковом Mantine 9 с единственной правкой:
 * своя тёмная гамма (`frontend/src/theme.ts`). Значения ниже перенесены
 * оттуда дословно, чтобы два приложения не разъезжались по цвету: правка в
 * теме сайта должна повторяться здесь, иначе телефон и браузер начнут
 * показывать одну систему по-разному.
 *
 * Одно отличие от сайта сделано намеренно. В браузере фон страницы и фон
 * карточек одинаково белые, а отделяет их боковое меню шириной 220 точек и
 * воздух вокруг. На экране в 360 точек ни того, ни другого нет, и карточка
 * на одноцветном фоне держится на одной волосяной рамке. Поэтому фон
 * экрана — `#f8f9fa` (Mantine gray.0, тот же цвет, которым сайт
 * подсвечивает строки), а карточки остаются белыми. Это не недосмотр и
 * «чинить» обратно на `#fff` не нужно.
 */

export interface Palette {
  /** Фон экрана. */
  bg: string;
  /** Фон карточек, полей, шапки и панели разделов. */
  surface: string;
  /** Подсветка нажатой строки или кнопки. */
  surfaceHover: string;
  border: string;
  text: string;
  dim: string;
  placeholder: string;

  primary: string;
  primaryHover: string;
  /** Заливка и текст кнопки `variant="light"` — синей. */
  primaryTint: string;
  primaryTintHover: string;
  primaryTintText: string;
  onPrimary: string;

  /** Заливка и текст остальных смысловых цветов: сообщения, значки. */
  redTint: string;
  redText: string;
  yellowTint: string;
  yellowText: string;
  greenTint: string;
  greenText: string;
  orangeTint: string;
  orangeText: string;
  grayTint: string;

  disabledBg: string;
  disabledText: string;
}

export const light: Palette = {
  bg: '#f8f9fa',
  surface: '#ffffff',
  surfaceHover: '#f1f3f5',
  border: '#ced4da',
  text: '#000000',
  dim: '#868e96',
  placeholder: '#adb5bd',

  primary: '#228be6',
  primaryHover: '#1c7ed6',
  primaryTint: '#e7f5ff',
  primaryTintHover: '#d0ebff',
  primaryTintText: '#1971c2',
  onPrimary: '#ffffff',

  redTint: '#ffe3e3',
  redText: '#c92a2a',
  yellowTint: '#fff3bf',
  yellowText: '#e67700',
  greenTint: '#d3f9d8',
  greenText: '#2f9e44',
  orangeTint: '#ffe8cc',
  orangeText: '#d9480f',
  grayTint: '#f1f3f5',

  disabledBg: '#e9ecef',
  disabledText: '#adb5bd',
};

/** Тёмная гамма — из `frontend/src/theme.ts`, где она и объясняется: стандартный
 * тёмный Mantine выглядит задымлённым, поэтому фон уведён почти в чёрный, а
 * между ним и карточками оставлен заметный зазор. */
export const dark: Palette = {
  bg: '#0e1013',
  surface: '#191b1f',
  surfaceHover: '#25282d',
  border: '#33363c',
  text: '#c9ccd1',
  dim: '#8b9098',
  placeholder: '#6b7078',

  primary: '#1971c2',
  primaryHover: '#1864ab',
  primaryTint: 'rgba(77, 171, 247, 0.15)',
  primaryTintHover: 'rgba(77, 171, 247, 0.25)',
  primaryTintText: '#4dabf7',
  onPrimary: '#ffffff',

  redTint: 'rgba(255, 135, 135, 0.15)',
  redText: '#ff8787',
  yellowTint: 'rgba(255, 212, 59, 0.15)',
  yellowText: '#ffd43b',
  greenTint: 'rgba(105, 219, 124, 0.15)',
  greenText: '#69db7c',
  orangeTint: 'rgba(255, 169, 77, 0.15)',
  orangeText: '#ffa94d',
  grayTint: '#25282d',

  disabledBg: '#25282d',
  disabledText: '#6b7078',
};

/** Скругления Mantine: по умолчанию 8 почти везде. */
export const radius = { sm: 4, md: 8, full: 999 } as const;

/** Шкала шрифта Mantine (xs…xl) и высоты строк при межстрочном 1.55. */
export const font = { xs: 12, sm: 14, md: 16, lg: 18, xl: 20 } as const;
export const line = { xs: 19, sm: 22, md: 25, lg: 28, xl: 31 } as const;

/** Заголовки Mantine: h2 26, h3 22, h4 18 — все весом 700. */
export const heading = {
  2: { fontSize: 26, lineHeight: 34 },
  3: { fontSize: 22, lineHeight: 30 },
  4: { fontSize: 18, lineHeight: 26 },
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

/**
 * Высота нажимаемых элементов.
 *
 * У Mantine кнопка размера `sm` — 36 точек, и заказчик просил «точно как в
 * вебе». Мышью в 36 попадают, пальцем у шкафа — не всегда, поэтому взяты 48:
 * это рекомендация Android для нажимаемых элементов и всего на 12 точек
 * больше веба — та же кнопка, на размер крупнее, а не другой интерфейс.
 * Вдобавок у мелких элементов есть `hitSlop`: он расширяет область нажатия,
 * ничего не меняя на вид.
 *
 * Понадобится компактнее — правится здесь, во всех экранах сразу.
 */
export const control = { md: 48, sm: 44, padH: 16, padHSm: 12 } as const;

export const hairline = 1;
