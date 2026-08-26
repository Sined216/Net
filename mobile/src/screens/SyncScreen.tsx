/**
 * Главный экран: связь с WireMap. Всё, что тут делают, делают в офисе.
 *
 * Два действия и оба требуют сети:
 * - **забрать снимок** перед выходом в цех;
 * - **выгрузить найденное** после возвращения.
 *
 * Экран намеренно говорит, что снимок целиком заменяется, а находки идут
 * не в спецификацию, а «на разбор». Человек должен понимать это до того,
 * как нажмёт, а не после.
 */

import { useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ApiError, fetchSnapshot, login, uploadFindings } from '../api/client';
import { saveSnapshot } from '../db/database';
import { collectUnsent, markSent, clearSent } from '../db/queue';
import { useAppState, snapshotAge } from '../state';
import { Button, Card, Dim, Field, Notice, Screen, Title, colors } from '../ui';
import type { RootStackParams } from '../App';

type Props = NativeStackScreenProps<RootStackParams, 'Sync'>;

export function SyncScreen({ navigation }: Props) {
  const { meta, pending, ready, token, setToken, refresh, connection } = useAppState();

  const [baseUrl, setBaseUrl] = useState(meta?.base_url ?? 'http://');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<null | 'download' | 'upload'>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const age = meta ? snapshotAge(meta.taken_at) : null;
  const hasQueue = pending.devices + pending.links > 0;

  /** Вход нужен обоим действиям, поэтому он общий и делается по месту:
   * токен живёт в памяти и пропадает при перезапуске. */
  async function ensureToken(): Promise<string> {
    if (token) return token;
    if (!username.trim() || !password) {
      throw new ApiError(0, 'Введите логин и пароль — без входа сервер не ответит.');
    }
    const fresh = await login(baseUrl.trim(), username.trim(), password);
    setToken(fresh);
    return fresh;
  }

  async function handleDownload() {
    setBusy('download'); setError(null); setDone(null);
    try {
      const url = baseUrl.trim();
      const fresh = await ensureToken();
      const snapshot = await fetchSnapshot({ baseUrl: url, token: fresh, siteId: null });
      await saveSnapshot(snapshot, url);
      await refresh();
      setDone(`Снимок «${snapshot.site_name}» загружен: устройств ${snapshot.devices.length}, связей ${snapshot.links.length}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleUpload() {
    setBusy('upload'); setError(null); setDone(null);
    try {
      const fresh = await ensureToken();
      const link = connection(baseUrl.trim());
      if (!link) throw new ApiError(0, 'Сначала загрузите снимок — без него неизвестно, на какую площадку выгружать.');

      const payload = await collectUnsent();
      if (payload.devices.length + payload.links.length === 0) {
        setDone('Отправлять нечего — очередь пуста.');
        return;
      }
      const result = await uploadFindings({ ...link, token: fresh }, payload);
      // По ключам из ответа, а не «всё, что отправили»: сервер перечисляет
      // и те, что принял в прошлый раз до обрыва связи.
      await markSent(result.accepted_uuids);
      await refresh();
      setDone(
        `Отправлено. Устройств: принято ${result.devices_added}`
        + (result.devices_duplicate ? `, уже были ${result.devices_duplicate}` : '')
        + `; связей: принято ${result.links_added}`
        + (result.links_duplicate ? `, уже были ${result.links_duplicate}` : '')
        + '. Записи ждут разбора в WireMap, на вкладке «Импорт и обход».',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Card>
          <Title>Снимок площадки</Title>
          {!ready ? <Dim>Читаю базу…</Dim> : meta ? (
            <>
              <Text style={styles.site}>{meta.site_name}</Text>
              <Dim>{`Загружен ${age?.text}`}</Dim>
              {age?.stale ? (
                <View style={{ marginTop: 10 }}>
                  <Notice kind="warn">
                    Снимку больше суток. В офисе могли что-то поправить — если есть связь, загрузите заново.
                  </Notice>
                </View>
              ) : null}
              <View style={{ marginTop: 12 }}>
                <Button title="Открыть спецификацию" kind="secondary" onPress={() => navigation.navigate('Devices')} />
              </View>
            </>
          ) : (
            <Dim>Снимка ещё нет. Загрузите его в офисе — в цеху сети не будет.</Dim>
          )}
        </Card>

        <Card>
          <Title>Найдено в цеху</Title>
          {hasQueue ? (
            <Text style={styles.pending}>
              {`Ждут отправки: устройств ${pending.devices}, связей ${pending.links}`}
            </Text>
          ) : (
            <Dim>Пока ничего не отмечено.</Dim>
          )}
          <View style={{ marginTop: 12 }}>
            <Button title="Что найдено" kind="secondary" onPress={() => navigation.navigate('Queue')} />
          </View>
        </Card>

        <Card>
          <Title>Связь с WireMap</Title>
          <Field
            label="Адрес сервера"
            hint="Тот же, что открываете в браузере в офисе"
            value={baseUrl} onChangeText={setBaseUrl}
            placeholder="http://10.10.1.5:8000"
            autoCapitalize="none" keyboardType="url"
          />
          {token ? (
            <Dim>Вход выполнен. Токен действует до перезапуска приложения.</Dim>
          ) : (
            <>
              <Field label="Логин" value={username} onChangeText={setUsername} autoCapitalize="none" />
              <Field label="Пароль" value={password} onChangeText={setPassword} secureTextEntry />
            </>
          )}

          {error ? <Notice kind="error">{error}</Notice> : null}
          {done ? <Notice kind="ok">{done}</Notice> : null}

          <View style={{ marginTop: 6 }}>
            <Button
              title="Забрать снимок" onPress={handleDownload}
              busy={busy === 'download'} disabled={busy !== null || baseUrl.trim().length < 8}
            />
            <Dim>Заменяет то, что сейчас на телефоне. Найденное в цеху при этом остаётся.</Dim>
          </View>

          <View style={{ marginTop: 16 }}>
            <Button
              title="Выгрузить найденное" onPress={handleUpload}
              busy={busy === 'upload'} disabled={busy !== null || !hasQueue}
            />
            <Dim>
              Записи попадают не в спецификацию, а на разбор: в WireMap человек переносит их по одной.
            </Dim>
          </View>
        </Card>

        {pending.devices + pending.links === 0 ? (
          <Card>
            <Button
              title="Убрать отправленное" kind="secondary"
              onPress={async () => { await clearSent(); await refresh(); setDone('Отправленные записи убраны.'); }}
            />
            <Dim>Очищает список находок, которые сервер уже принял.</Dim>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  site: { fontSize: 18, fontWeight: '600', color: colors.text, marginBottom: 2 },
  pending: { fontSize: 16, color: colors.warn, fontWeight: '600' },
});
