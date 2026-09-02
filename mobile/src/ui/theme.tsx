/**
 * Тема: светлая или тёмная, по настройке системы — как на сайте, где
 * `MantineProvider` стоит с `defaultColorScheme="auto"`.
 *
 * Оба набора стилей собираются один раз при загрузке модуля, а не на каждую
 * перерисовку: `StyleSheet.create` имеет смысл только тогда, когда его
 * результат переживает рендер. Смена темы — это переключение между двумя
 * готовыми наборами.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { DefaultTheme, type Theme as NavTheme } from '@react-navigation/native';
import {
  control, dark, font, hairline, heading, light, line, radius, space, type Palette,
} from './tokens';

function build(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.bg },
    screenPad: { padding: space.lg },

    paper: {
      backgroundColor: p.surface,
      borderWidth: hairline,
      borderColor: p.border,
      borderRadius: radius.md,
      overflow: 'hidden',
    },
    divider: { height: hairline, backgroundColor: p.border },

    text: { color: p.text, fontSize: font.sm, lineHeight: line.sm },
    heading: { color: p.text, fontWeight: '700' },

    input: {
      minHeight: control.md,
      borderWidth: hairline,
      borderColor: p.border,
      borderRadius: radius.md,
      backgroundColor: p.surface,
      paddingHorizontal: space.md,
      fontSize: font.md,
      color: p.text,
    },
    inputFocused: { borderColor: p.primary },
    inputError: { borderColor: p.redText },
    inputMultiline: { minHeight: 112, paddingTop: space.md, textAlignVertical: 'top' },

    button: {
      minHeight: control.md,
      borderRadius: radius.md,
      paddingHorizontal: control.padH,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.sm,
      alignSelf: 'flex-start',
      borderWidth: hairline,
      borderColor: 'transparent',
    },
    buttonSm: { minHeight: control.sm, paddingHorizontal: control.padHSm },

    iconButton: {
      width: control.sm,
      height: control.sm,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },

    badge: {
      height: 22,
      borderRadius: radius.full,
      paddingHorizontal: space.sm,
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: hairline,
      borderColor: 'transparent',
    },
    badgeText: { fontSize: font.xs, fontWeight: '700', letterSpacing: 0.25 },

    alert: {
      borderRadius: radius.md,
      padding: space.md,
      flexDirection: 'row',
      gap: space.md,
      alignItems: 'flex-start',
    },

    listRow: {
      minHeight: 56,
      paddingVertical: space.md,
      paddingHorizontal: space.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
    },
    listRowBorder: { borderTopWidth: hairline, borderTopColor: p.border },
  });
}

const sheets = { light: build(light), dark: build(dark) };

export interface ThemeValue {
  p: Palette;
  s: ReturnType<typeof build>;
  isDark: boolean;
}

const Context = createContext<ThemeValue>({ p: light, s: sheets.light, isDark: false });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const value = useMemo<ThemeValue>(
    () => (scheme === 'dark'
      ? { p: dark, s: sheets.dark, isDark: true }
      : { p: light, s: sheets.light, isDark: false }),
    [scheme],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useTheme(): ThemeValue {
  return useContext(Context);
}

/** Тема для самой навигации: шапка экрана и панель разделов рисуются не
 * нашими компонентами, а React Navigation, и цвета им нужно отдать отдельно —
 * иначе при тёмной системе шапка останется светлой. */
export function navigationTheme({ p, isDark }: ThemeValue): NavTheme {
  return {
    dark: isDark,
    colors: {
      primary: p.primary,
      background: p.bg,
      card: p.surface,
      text: p.text,
      border: p.border,
      notification: p.orangeText,
    },
    fonts: DefaultTheme.fonts,
  };
}

export { control, font, heading, line, radius, space, hairline };
export type { Palette };
