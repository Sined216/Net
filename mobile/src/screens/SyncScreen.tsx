/**
 * Обмен: забрать снимок перед выходом в цех, выгрузить найденное после.
 *
 * Оба действия требуют сети и делаются в офисе. Экран намеренно говорит,
 * что снимок целиком заменяется, а находки идут не в спецификацию, а «на
 * разбор»: человек должен понимать это до того, как нажмёт, а не после.
 *
 * Настройки связи живут на отдельном экране — они запоминаются, и держать
 * их перед глазами при каждом обмене незачем.
 */

import { useState } from 'react';
import { View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ApiError, fetchSnapshot, uploadFindings } from '../api/client';
import { saveSnapshot } from '../db/database';
import { collectUnsent, markSent } from '../db/queue';
import { useAppState, sessionUntil, snapshotAge } from '../state';
import {
  Alert, Badge, Button, Dim, Group, IconButton, PageHeader, Paper, Screen, Stack, Text, Title,
} from '../ui';
import type { SyncStackParams } from '../navigation/types';

type Props = NativeStackScreenProps<SyncStackParams, 'Sync'>;

export function SyncScreen({ navigation }: Props) {
  const { meta, pending, settings, signOut, refresh, connection } = useAppState();

  const [busy, setBusy] = useState<null | 'download' | 'upload'>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const age = meta ? snapshotAge(meta.taken_at) : null;
  const waiting = pending.devices + pending.links;
  const until = sessionUntil(settings.tokenExpiresAt);

  /** Оба действия начинаются одинаково: нужен живой сеанс. Нет — отправляем
   * вводить пароль, а не показываем отказ, который человеку нечем починить
   * прямо здесь. */
  function requireSession(): string | null {
    if (settings.token) return settings.token;
    setError(null);
    navigation.navigate('Connection');
    return null;
  }

  /** Сервер не принял токен: часы разъехались, сервер перезапустили с новым
   * ключом, учётку отключили. Гасим сеанс и отправляем входить заново —
   * адрес и логин при этом остаются. */
  async function handleFailure(e: unknown) {
    if (e instanceof ApiError && e.status === 401) {
      await signOut();
      setError('Сеанс истёк. Введите пароль заново.');
      navigation.navigate('Connection');
      return;
    }
    // Сеанс живой, но пароль пора сменить: назначен не человеком или
    // просрочен по сроку из политики — сервер отвечает 403 с текстом,
    // упоминающим ручку смены. Ведём прямо туда, а не показываем текст,
    // который человеку самому пришлось бы разбирать.
    if (e instanceof ApiError && e.status === 403 && e.message.includes('/auth/me/password')) {
      navigation.navigate('ChangePassword');
      return;
    }
    setError(e instanceof Error ? e.message : String(e));
  }

  async function handleDownload() {
    const token = requireSession();
    if (!token) return;
    setBusy('download'); setError(null); setDone(null);
    try {
      const url = settings.baseUrl;
      const snapshot = await fetchSnapshot({ baseUrl: url, token, siteId: null });
      await saveSnapshot(snapshot, url);
      await refresh();
      setDone(`Снимок «${snapshot.site_name}» загружен: устройств ${snapshot.devices.length}, связей ${snapshot.links.length}.`);
    } catch (e) {
      await handleFailure(e);
    } finally {
      setBusy(null);
    }
  }

  async function handleUpload() {
    const token = requireSession();
    if (!token) return;
    setBusy('upload'); setError(null); setDone(null);
    try {
      const link = connection();
      if (!link) throw new ApiError(0, 'Сначала загрузите снимок — без него неизвестно, на какую площадку выгружать.');

      const payload = await collectUnsent();
      if (payload.devices.length + payload.links.length === 0) {
        setDone('Отправлять нечего — очередь пуста.');
        return;
      }
      const result = await uploadFindings({ ...link, token }, payload);
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
      await handleFailure(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen scroll>
      <PageHeader title="Обмен">
        <IconButton
          icon="settings" label="Связь с WireMap"
          onPress={() => navigation.navigate('Connection')}
        />
      </PageHeader>

      <Stack>
        <Dim>Оба действия требуют сети — их делают в офисе, до выхода в цех и после.</Dim>

        {error ? <Alert color="red">{error}</Alert> : null}
        {done ? <Alert color="green">{done}</Alert> : null}

        <Paper>
          <Stack gap="md">
            <Title order={4}>Снимок площадки</Title>
            {meta ? (
              <>
                <Text size="lg" fw="700">{meta.site_name}</Text>
                <Dim>{`Загружен ${age?.text}`}</Dim>
                {age?.stale ? (
                  <Alert color="yellow">
                    Снимку больше суток. В офисе могли что-то поправить — если есть связь, загрузите заново.
                  </Alert>
                ) : null}
              </>
            ) : (
              <Dim>Снимка ещё нет. Загрузите его в офисе — в цеху сети не будет.</Dim>
            )}
            <Button
              title="Забрать снимок" icon="download-cloud" fullWidth
              onPress={() => { void handleDownload(); }}
              busy={busy === 'download'}
              disabled={busy !== null || settings.baseUrl.length < 8}
            />
            <Dim size="xs">Заменяет то, что сейчас на телефоне. Найденное в цеху при этом остаётся.</Dim>
          </Stack>
        </Paper>

        <Paper>
          <Stack gap="md">
            <Group justify="space-between">
              <Title order={4}>Найдено в цеху</Title>
              {waiting > 0 ? <Badge color="orange">{`ждут отправки: ${waiting}`}</Badge> : null}
            </Group>
            {waiting > 0
              ? <Dim>{`Устройств ${pending.devices}, связей ${pending.links}.`}</Dim>
              : <Dim>Пока ничего не отмечено.</Dim>}
            <Button
              title="Выгрузить найденное" variant="light" icon="upload-cloud" fullWidth
              onPress={() => { void handleUpload(); }}
              busy={busy === 'upload'}
              disabled={busy !== null || waiting === 0}
            />
            <Dim size="xs">
              Записи попадают не в спецификацию, а на разбор: в WireMap человек переносит их по одной.
            </Dim>
          </Stack>
        </Paper>

        <Paper padding="sm">
          <Group justify="space-between">
            <View style={{ flex: 1 }}>
              <Text size="sm" numberOfLines={1}>{settings.baseUrl || 'адрес не задан'}</Text>
              <Dim size="xs">
                {settings.token
                  ? `${settings.username}${until ? ` · сеанс до ${until}` : ''}`
                  : 'вход не выполнен'}
              </Dim>
            </View>
            <Button
              title="Изменить" variant="subtle" size="sm"
              onPress={() => navigation.navigate('Connection')}
            />
          </Group>
        </Paper>
      </Stack>
    </Screen>
  );
}
