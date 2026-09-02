/**
 * Набор элементов, повторяющий вид веб-версии.
 *
 * Правила взяты с сайта и держатся во всех экранах:
 *
 * - у экрана одна заливная кнопка — главное действие; вторичные светлые,
 *   третьестепенные без фона, «Отмена» с рамкой;
 * - пропуск значения — приглушённое тире, а не пустое место;
 * - опознавательный текст строки (код устройства, подпись порта) весом 700;
 * - карточка — белый прямоугольник с волосяной рамкой, без тени.
 *
 * Списки на сайте — плотные таблицы. На телефоне таблица не помещается, и
 * её роль играет `ListRow`: строки лежат в одной карточке и разделены той же
 * волосяной линией, а не превращаются каждая в отдельную карточку.
 */

import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text as RNText, TextInput,
  View, type StyleProp, type TextStyle, type ViewStyle,
} from 'react-native';
import { Feather, ICON, type IconName } from './icons';
import { useTheme } from './theme';
import { control, font, heading, line, radius, space } from './tokens';

/* ─── основа ─────────────────────────────────────────────────────────── */

export function Screen({ children, scroll, padded = true }: {
  children: ReactNode; scroll?: boolean; padded?: boolean;
}) {
  const { s } = useTheme();
  const pad = padded ? s.screenPad : undefined;
  if (scroll) {
    return (
      <View style={s.screen}>
        <ScrollView contentContainerStyle={pad} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    );
  }
  return <View style={[s.screen, pad]}>{children}</View>;
}

export function Paper({ children, padding = 'md', style }: {
  children: ReactNode; padding?: 'none' | 'sm' | 'md'; style?: StyleProp<ViewStyle>;
}) {
  const { s } = useTheme();
  const pad = padding === 'none' ? 0 : padding === 'sm' ? space.md : space.lg;
  return <View style={[s.paper, { padding: pad }, style]}>{children}</View>;
}

/** Имя сохранено с прежнего набора: карточка потуже, как `Card padding="sm"`. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <Paper padding="sm" style={style}>{children}</Paper>;
}

export function Divider() {
  const { s } = useTheme();
  return <View style={s.divider} />;
}

export function Stack({ children, gap = 'md' }: {
  children: ReactNode; gap?: keyof typeof space;
}) {
  return <View style={{ gap: space[gap] }}>{children}</View>;
}

export function Group({ children, gap = 'sm', justify = 'start', align = 'center', wrap, style }: {
  children: ReactNode;
  gap?: keyof typeof space;
  justify?: 'start' | 'end' | 'space-between';
  align?: 'center' | 'start' | 'end';
  wrap?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const justifyContent = justify === 'start' ? 'flex-start'
    : justify === 'end' ? 'flex-end' : 'space-between';
  const alignItems = align === 'center' ? 'center' : align === 'start' ? 'flex-start' : 'flex-end';
  return (
    <View style={[{
      flexDirection: 'row', gap: space[gap], justifyContent, alignItems,
      flexWrap: wrap ? 'wrap' : 'nowrap',
    }, style]}>
      {children}
    </View>
  );
}

/* ─── текст ──────────────────────────────────────────────────────────── */

type Tone = 'text' | 'dim' | 'primary' | 'red' | 'green' | 'orange';

function toneColor(tone: Tone, p: ReturnType<typeof useTheme>['p']): string {
  switch (tone) {
    case 'dim': return p.dim;
    case 'primary': return p.primaryTintText;
    case 'red': return p.redText;
    case 'green': return p.greenText;
    case 'orange': return p.orangeText;
    default: return p.text;
  }
}

export function Text({ children, size = 'sm', c = 'text', fw, mono, numberOfLines, style }: {
  children: ReactNode;
  size?: keyof typeof font;
  c?: Tone;
  fw?: '400' | '600' | '700';
  mono?: boolean;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
}) {
  const { p } = useTheme();
  return (
    <RNText
      numberOfLines={numberOfLines}
      style={[{
        fontSize: font[size], lineHeight: line[size], color: toneColor(c, p),
        fontWeight: fw, fontFamily: mono ? 'monospace' : undefined,
      }, style]}
    >
      {children}
    </RNText>
  );
}

/** Приглушённая строка — то же, что `c="dimmed"` на сайте. */
export function Dim({ children, size = 'sm' }: { children: ReactNode; size?: keyof typeof font }) {
  return <Text size={size} c="dim">{children}</Text>;
}

export function Title({ children, order = 2 }: { children: ReactNode; order?: 2 | 3 | 4 }) {
  const { s } = useTheme();
  return <RNText style={[s.heading, heading[order]]}>{children}</RNText>;
}

/** Шапка экрана: заголовок с числом слева, действия справа — как на сайте. */
export function PageHeader({ title, count, children }: {
  title: string; count?: number; children?: ReactNode;
}) {
  return (
    <Group justify="space-between" align="center" wrap style={{ marginBottom: space.lg }}>
      <Group gap="sm">
        <Title>{title}</Title>
        {count !== undefined ? <Text size="md" c="dim">{count}</Text> : null}
      </Group>
      {children ? <Group gap="sm">{children}</Group> : null}
    </Group>
  );
}

/* ─── кнопки ─────────────────────────────────────────────────────────── */

export type ButtonVariant = 'filled' | 'light' | 'subtle' | 'default';

export function Button({
  title, onPress, variant = 'filled', color = 'blue', size = 'md',
  icon, fullWidth, busy, disabled,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  color?: 'blue' | 'red';
  size?: 'md' | 'sm';
  icon?: IconName;
  fullWidth?: boolean;
  busy?: boolean;
  disabled?: boolean;
}) {
  const { p, s } = useTheme();
  const off = disabled || busy;

  const tint = color === 'red' ? p.redTint : p.primaryTint;
  const tintText = color === 'red' ? p.redText : p.primaryTintText;
  const solid = color === 'red' ? p.redText : p.primary;
  const solidPressed = color === 'red' ? p.redText : p.primaryHover;

  function skin(pressed: boolean): ViewStyle {
    if (off) return { backgroundColor: variant === 'subtle' ? 'transparent' : p.disabledBg };
    switch (variant) {
      case 'filled':
        return { backgroundColor: pressed ? solidPressed : solid };
      case 'light':
        return { backgroundColor: pressed && color === 'blue' ? p.primaryTintHover : tint };
      case 'subtle':
        return { backgroundColor: pressed ? p.surfaceHover : 'transparent' };
      default:
        return { backgroundColor: pressed ? p.surfaceHover : p.surface, borderColor: p.border };
    }
  }

  const label = off ? p.disabledText
    : variant === 'filled' ? p.onPrimary
      : variant === 'default' ? p.text
        : tintText;

  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={({ pressed }) => [
        s.button,
        size === 'sm' && s.buttonSm,
        fullWidth && { alignSelf: 'stretch' },
        skin(pressed),
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={label} /> : (
        <>
          {icon ? <Feather name={icon} size={ICON.sm} color={label} /> : null}
          <RNText style={{
            color: label,
            fontSize: size === 'sm' ? font.sm : font.md,
            fontWeight: '600',
          }}>
            {title}
          </RNText>
        </>
      )}
    </Pressable>
  );
}

/**
 * Иконка-действие в строке — то же, что `RowAction` на сайте.
 *
 * `label` обязателен и должен называть строку («Убрать «свитч в щитовой»»),
 * а не одно действие: иначе в списке из десяти кнопок «Убрать» непонятно,
 * какая из них какая, — и на слух, и на ощупь.
 */
export function IconButton({ icon, label, onPress, color = 'default', disabled }: {
  icon: IconName;
  label: string;
  onPress: () => void;
  color?: 'default' | 'red';
  disabled?: boolean;
}) {
  const { p, s } = useTheme();
  const tint = disabled ? p.disabledText : color === 'red' ? p.redText : p.dim;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [
        s.iconButton,
        pressed && !disabled ? { backgroundColor: p.surfaceHover } : null,
      ]}
    >
      <Feather name={icon} size={ICON.lg} color={tint} />
    </Pressable>
  );
}

/* ─── поля ───────────────────────────────────────────────────────────── */

export function Field({ label, hint, error, style, ...rest }: {
  label?: string;
  hint?: string;
  error?: string | null;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences';
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'numeric' | 'url';
  multiline?: boolean;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { p, s } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={style}>
      {label ? <Text size="sm" fw="600" style={{ marginBottom: space.xs }}>{label}</Text> : null}
      {hint ? <Dim size="xs">{hint}</Dim> : null}
      <TextInput
        {...rest}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholderTextColor={p.placeholder}
        style={[
          s.input,
          hint ? { marginTop: space.xs } : null,
          rest.multiline ? s.inputMultiline : null,
          focused ? s.inputFocused : null,
          error ? s.inputError : null,
        ]}
      />
      {error ? <Text size="xs" c="red" style={{ marginTop: space.xs }}>{error}</Text> : null}
    </View>
  );
}

/** Поиск: то же поле с лупой слева и крестиком справа, когда есть что стереть. */
export function SearchField({ value, onChangeText, placeholder }: {
  value: string; onChangeText: (value: string) => void; placeholder?: string;
}) {
  const { p, s } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[
      s.input, focused ? s.inputFocused : null,
      { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md },
    ]}>
      <Feather name="search" size={ICON.md} color={p.dim} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={p.placeholder}
        autoCapitalize="none"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ flex: 1, fontSize: font.md, color: p.text, paddingVertical: 0 }}
      />
      {value.length > 0 ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={8} accessibilityLabel="Очистить поиск">
          <Feather name="x" size={ICON.md} color={p.dim} />
        </Pressable>
      ) : null}
    </View>
  );
}

/* ─── сообщения и метки ──────────────────────────────────────────────── */

export type ToneColor = 'gray' | 'blue' | 'red' | 'green' | 'orange' | 'yellow';

function tones(p: ReturnType<typeof useTheme>['p'], color: ToneColor) {
  switch (color) {
    case 'blue': return { bg: p.primaryTint, fg: p.primaryTintText };
    case 'red': return { bg: p.redTint, fg: p.redText };
    case 'green': return { bg: p.greenTint, fg: p.greenText };
    case 'orange': return { bg: p.orangeTint, fg: p.orangeText };
    case 'yellow': return { bg: p.yellowTint, fg: p.yellowText };
    default: return { bg: p.grayTint, fg: p.dim };
  }
}

export function Badge({ children, color = 'gray', variant = 'light' }: {
  children: ReactNode; color?: ToneColor; variant?: 'light' | 'outline';
}) {
  const { p, s } = useTheme();
  const { bg, fg } = tones(p, color);
  return (
    <View style={[s.badge, variant === 'outline'
      ? { backgroundColor: 'transparent', borderColor: fg }
      : { backgroundColor: bg }]}>
      <RNText style={[s.badgeText, { color: fg }]}>{children}</RNText>
    </View>
  );
}

const ALERT_ICON: Record<ToneColor, IconName> = {
  red: 'alert-circle',
  yellow: 'alert-triangle',
  orange: 'alert-triangle',
  green: 'check-circle',
  blue: 'info',
  gray: 'info',
};

export function Alert({ color, title, children }: {
  color: ToneColor; title?: string; children: ReactNode;
}) {
  const { p, s } = useTheme();
  const { bg, fg } = tones(p, color);
  return (
    <View style={[s.alert, { backgroundColor: bg }]}>
      <Feather name={ALERT_ICON[color]} size={ICON.md} color={fg} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        {title ? (
          <RNText style={{ color: fg, fontSize: font.sm, fontWeight: '700', marginBottom: 2 }}>
            {title}
          </RNText>
        ) : null}
        <RNText style={{ color: fg, fontSize: font.sm, lineHeight: line.sm }}>{children}</RNText>
      </View>
    </View>
  );
}

/* ─── строки списка ──────────────────────────────────────────────────── */

export function ListRow({ title, subtitle, meta, badges, right, onPress, first }: {
  title: string;
  subtitle?: string;
  meta?: string;
  badges?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  /** Первая строка карточки — без верхней линии, её роль играет рамка. */
  first?: boolean;
}) {
  const { p, s } = useTheme();
  const body = (
    <>
      <View style={{ flex: 1, gap: 2 }}>
        <Text size="md" fw="700" numberOfLines={1}>{title}</Text>
        {subtitle ? <Text size="sm" numberOfLines={2}>{subtitle}</Text> : null}
        {meta ? <Dim>{meta}</Dim> : null}
        {badges ? <Group gap="xs" wrap style={{ marginTop: 2 }}>{badges}</Group> : null}
      </View>
      {right}
      {onPress ? <Feather name="chevron-right" size={ICON.md} color={p.dim} /> : null}
    </>
  );

  if (!onPress) {
    return <View style={[s.listRow, !first && s.listRowBorder]}>{body}</View>;
  }
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.listRow,
        !first && s.listRowBorder,
        pressed ? { backgroundColor: p.surfaceHover } : null,
      ]}
    >
      {body}
    </Pressable>
  );
}

/** Пусто — это не ошибка, поэтому не жёлтая плашка, а спокойная надпись. */
export function Empty({ icon, children }: { icon: IconName; children: ReactNode }) {
  const { p } = useTheme();
  return (
    <View style={styles.empty}>
      <Feather name={icon} size={32} color={p.dim} />
      <Text size="sm" c="dim" style={{ textAlign: 'center' }}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: space.md, paddingVertical: space.xl },
});

export { control, font, radius, space };
