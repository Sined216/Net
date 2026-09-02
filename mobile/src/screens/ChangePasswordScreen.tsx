/**
 * Смена пароля.
 *
 * Открывается по кнопке на экране связи или принудительно — когда пароль
 * назначен не самим человеком (первый вход, сброс администратором) или
 * истёк по сроку, который настроил админ. В принудительном случае экран
 * без выхода назад: пока пароль не сменён, работать нечем — сервер
 * отклонит любой другой запрос тем же требованием.
 */

import { useEffect, useLayoutEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { changePassword, getPasswordPolicy } from '../api/client';
import { useAppState } from '../state';
import {
  Alert, Button, Dim, Field, Paper, Screen, Stack,
} from '../ui';
import type { SyncStackParams } from '../navigation/types';

type Props = NativeStackScreenProps<SyncStackParams, 'ChangePassword'>;

/** Пока политика не подгрузилась — прежнее значение по умолчанию: сервер
 * всё равно проверит настоящее требование, это только подсказка заранее. */
const FALLBACK_MIN_LENGTH = 12;

export function ChangePasswordScreen({ route, navigation }: Props) {
  const forced = route.params?.forced ?? false;
  const { settings, connection, saveSession } = useAppState();

  const [minLength, setMinLength] = useState(FALLBACK_MIN_LENGTH);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Принудительно — назад не уйти мимо смены пароля, обычным свайпом или
  // стрелкой в шапке: пока не сменён, всё остальное сервер и так отклонит.
  useLayoutEffect(() => {
    if (forced) navigation.setOptions({ headerLeft: () => null, gestureEnabled: false });
  }, [forced, navigation]);

  useEffect(() => {
    const link = connection();
    if (!link) return;
    getPasswordPolicy(link).then((p) => setMinLength(p.min_length)).catch(() => {
      // Не подгрузилось — остаётся дефолт; сервер всё равно проверит сам.
    });
  }, [connection]);

  const tooShort = next.length > 0 && next.length < minLength;
  const mismatch = repeat.length > 0 && next !== repeat;
  const canSubmit = current.length > 0 && next.length >= minLength && next === repeat && !busy;

  async function handleSubmit() {
    const link = connection();
    if (!link || !link.token) return;
    setBusy(true); setError(null);
    try {
      await changePassword(link, { current_password: current, new_password: next });
      // Новый пароль сеанс не меняет — токен тот же, флаг на сервере снят.
      await saveSession(link.token);
      if (forced) navigation.replace('Sync');
      else navigation.goBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <Stack>
        {forced ? (
          <Alert color="yellow">
            Прежде чем продолжить, задайте свой пароль — этот знает не только
            владелец, либо он устарел по сроку, который настроил администратор.
          </Alert>
        ) : (
          <Dim>Введите текущий пароль и придумайте новый.</Dim>
        )}

        <Paper>
          <Stack gap="lg">
            <Field
              label="Текущий пароль"
              value={current} onChangeText={setCurrent}
              secureTextEntry autoFocus
            />
            <Field
              label="Новый пароль"
              hint={`Не короче ${minLength} символов`}
              value={next} onChangeText={setNext}
              secureTextEntry
              error={tooShort ? `Слишком короткий — нужно не меньше ${minLength} символов` : null}
            />
            <Field
              label="Новый пароль ещё раз"
              value={repeat} onChangeText={setRepeat}
              secureTextEntry
              error={mismatch ? 'Пароли не совпадают' : null}
              onSubmitEditing={() => { void handleSubmit(); }}
            />

            {error ? <Alert color="red">{error}</Alert> : null}

            <Button
              title="Сменить пароль" icon="check" fullWidth
              onPress={() => { void handleSubmit(); }}
              busy={busy}
              disabled={!canSubmit}
            />
          </Stack>
        </Paper>

        <Dim size="xs">{`Вход выполнен как ${settings.username || '—'}.`}</Dim>
      </Stack>
    </Screen>
  );
}
