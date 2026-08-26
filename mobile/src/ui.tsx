/**
 * Общий вид приложения.
 *
 * Оформление рассчитано на цех, а не на стол: крупный шрифт, кнопки в
 * палец высотой, заметные поля ввода. Человек стоит у шкафа, часто в
 * перчатках, и мелкий аккуратный интерфейс здесь просто не работает.
 */

import type { ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';

export const colors = {
  bg: '#f4f6f8',
  card: '#ffffff',
  border: '#d5dbe1',
  text: '#1a2027',
  dim: '#68757f',
  accent: '#1971c2',
  ok: '#2b8a3e',
  warn: '#e8590c',
  danger: '#c92a2a',
};

export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Dim({ children }: { children: ReactNode }) {
  return <Text style={styles.dim}>{children}</Text>;
}

export function Field({ label, hint, ...rest }: {
  label: string;
  hint?: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences';
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'numeric' | 'url';
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <TextInput
        style={[styles.input, rest.multiline ? styles.inputMultiline : null]}
        placeholderTextColor={colors.dim}
        {...rest}
      />
    </View>
  );
}

export function Button({ title, onPress, kind = 'primary', busy, disabled }: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  busy?: boolean;
  disabled?: boolean;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.button,
        kind === 'secondary' && styles.buttonSecondary,
        kind === 'danger' && styles.buttonDanger,
        off && styles.buttonOff,
        pressed && !off && styles.buttonPressed,
      ]}
    >
      {busy ? <ActivityIndicator color="#fff" /> : (
        <Text style={[styles.buttonText, kind === 'secondary' && styles.buttonTextSecondary]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

/** Сообщение, которое нельзя пропустить: отказ сервера, предупреждение о
 * несвежем снимке. */
export function Notice({ kind, children }: { kind: 'error' | 'warn' | 'ok'; children: ReactNode }) {
  const tone = kind === 'error' ? colors.danger : kind === 'warn' ? colors.warn : colors.ok;
  return (
    <View style={[styles.notice, { borderLeftColor: tone }]}>
      <Text style={[styles.noticeText, { color: tone }]}>{children}</Text>
    </View>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 14 },
  card: {
    backgroundColor: colors.card, borderRadius: 10, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: colors.border,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 8 },
  dim: { fontSize: 14, color: colors.dim },
  field: { marginBottom: 14 },
  label: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 4 },
  hint: { fontSize: 13, color: colors.dim, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: '#fff',
    // 52 точки — палец попадает не глядя; стандартные 40 в перчатке мимо.
    minHeight: 52, paddingHorizontal: 12, fontSize: 17, color: colors.text,
  },
  inputMultiline: { minHeight: 96, paddingTop: 12, textAlignVertical: 'top' },
  button: {
    backgroundColor: colors.accent, borderRadius: 8, minHeight: 52,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginBottom: 10,
  },
  buttonSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border },
  buttonDanger: { backgroundColor: colors.danger },
  buttonOff: { opacity: 0.5 },
  buttonPressed: { opacity: 0.8 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  buttonTextSecondary: { color: colors.text },
  notice: {
    borderLeftWidth: 4, backgroundColor: '#fff', padding: 12, borderRadius: 6, marginBottom: 12,
  },
  noticeText: { fontSize: 15 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
});
