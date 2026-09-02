/**
 * Связь с WireMap: куда ходить и под кем.
 *
 * Экран отдельный и редко нужный — адрес с логином запоминаются, и после
 * первой настройки сюда заходят разве что когда истёк сеанс. Пароль не
 * сохраняется: он живёт только в поле ниже, пока экран открыт.
 */

import { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { login } from '../api/client';
import { useAppState, sessionUntil } from '../state';
import {
  Alert, Button, Dim, Field, Group, Paper, Screen, Stack, Text, Title, space,
} from '../ui';
import type { SyncStackParams } from '../navigation/types';

type Props = NativeStackScreenProps<SyncStackParams, 'Connection'>;

export function ConnectionScreen({ navigation }: Props) {
  const { settings, saveConnection, saveSession, signOut } = useAppState();

  const [baseUrl, setBaseUrl] = useState(settings.baseUrl || 'http://');
  const [username, setUsername] = useState(settings.username);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const until = sessionUntil(settings.tokenExpiresAt);

  async function handleLogin() {
    setBusy(true); setError(null);
    try {
      const url = baseUrl.trim();
      // Адрес и логин запоминаем до запроса: опечатка в пароле не должна
      // стирать то, что человек уже правильно набрал.
      await saveConnection(url, username.trim());
      const session = await login(url, username.trim(), password);
      // Адрес мог уточниться до `…/api` — сохраняем найденный, а не введённый.
      await saveConnection(session.baseUrl, username.trim());
      await saveSession(session.token);
      navigation.goBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <Stack>
        <Dim>
          Адрес — тот же, что открываете в браузере в офисе. Что API живёт
          на «/api», приложение выяснит само.
        </Dim>

        <Paper>
          <Stack gap="lg">
            <Field
              label="Адрес сервера"
              value={baseUrl} onChangeText={setBaseUrl}
              placeholder="http://10.10.1.5:8080"
              autoCapitalize="none" keyboardType="url"
            />
            <Field
              label="Логин"
              value={username} onChangeText={setUsername}
              autoCapitalize="none"
            />
            <Field
              label="Пароль"
              hint="Не сохраняется — спрашивается, когда истёк сеанс"
              value={password} onChangeText={setPassword}
              secureTextEntry
              onSubmitEditing={() => { void handleLogin(); }}
            />

            {error ? <Alert color="red">{error}</Alert> : null}

            <Button
              title={settings.token ? 'Войти заново' : 'Войти'}
              icon="log-in" fullWidth
              onPress={() => { void handleLogin(); }}
              busy={busy}
              disabled={baseUrl.trim().length < 8 || !username.trim() || !password}
            />
          </Stack>
        </Paper>

        {settings.token ? (
          <Paper>
            <Stack gap="md">
              <Title order={4}>Сеанс</Title>
              <Text size="sm" c="green">
                {until ? `Вход выполнен, действует до ${until}.` : 'Вход выполнен.'}
              </Text>
              <Dim size="xs">
                Пока сеанс жив, WireMap доступен без пароля — всякому, у кого
                разблокирован телефон. Отдаёте телефон — выйдите.
              </Dim>
              <Group justify="end" style={{ marginTop: space.xs }}>
                <Button
                  title="Выйти" variant="subtle" color="red" icon="log-out"
                  onPress={() => { void signOut(); }}
                />
              </Group>
            </Stack>
          </Paper>
        ) : null}
      </Stack>
    </Screen>
  );
}
