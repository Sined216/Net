/**
 * Что найдено за смену и что из этого уже уехало.
 *
 * Отправленное не пропадает из списка само: пока человек не убрал его
 * кнопкой, оно остаётся отчётом о сделанном. Пропади оно сразу после
 * выгрузки — не было бы способа убедиться, что уехало именно то, что
 * записывали.
 */

import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  deleteQueuedDevice, deleteQueuedLink, listQueuedDevices, listQueuedLinks,
} from '../db/queue';
import type { QueuedDevice, QueuedLink } from '../db/queue';
import { useAppState } from '../state';
import { Button, Card, Dim, Screen, Title, colors } from '../ui';

export function QueueScreen() {
  const { refresh } = useAppState();
  const [devices, setDevices] = useState<QueuedDevice[]>([]);
  const [links, setLinks] = useState<QueuedLink[]>([]);

  const load = useCallback(async () => {
    setDevices(await listQueuedDevices());
    setLinks(await listQueuedLinks());
  }, []);

  // Перечитываем при каждом показе: экран открывают сразу после того, как
  // что-то добавили, и старый список тут сбивал бы с толку.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function removeDevice(uuid: string) {
    await deleteQueuedDevice(uuid);
    await load();
    await refresh();
  }

  async function removeLink(uuid: string) {
    await deleteQueuedLink(uuid);
    await load();
    await refresh();
  }

  if (devices.length === 0 && links.length === 0) {
    return (
      <Screen>
        <Dim>Пока ничего не отмечено. Находки появятся здесь и уедут в WireMap из офиса.</Dim>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView>
        {devices.length > 0 ? (
          <Card>
            <Title>{`Устройства (${devices.length})`}</Title>
            {devices.map((item) => (
              <View key={item.client_uuid} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.main}>{item.name || item.template_name || 'без названия'}</Text>
                  <Dim>
                    {[item.template_name, item.management_ip, item.mac].filter(Boolean).join(' · ') || '—'}
                  </Dim>
                  <Status sent={item.sent} />
                </View>
                {!item.sent ? (
                  <View style={{ width: 110 }}>
                    <Button title="Убрать" kind="secondary" onPress={() => removeDevice(item.client_uuid)} />
                  </View>
                ) : null}
              </View>
            ))}
          </Card>
        ) : null}

        {links.length > 0 ? (
          <Card>
            <Title>{`Связи (${links.length})`}</Title>
            {links.map((item) => (
              <View key={item.client_uuid} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.main}>
                    {`${item.a_device_text ?? '?'}${item.a_port_text ? `/${item.a_port_text}` : ''}`
                      + ` → ${item.b_device_text ?? '?'}${item.b_port_text ? `/${item.b_port_text}` : ''}`}
                  </Text>
                  {item.medium ? <Dim>{`среда: ${item.medium}`}</Dim> : null}
                  <Status sent={item.sent} />
                </View>
                {!item.sent ? (
                  <View style={{ width: 110 }}>
                    <Button title="Убрать" kind="secondary" onPress={() => removeLink(item.client_uuid)} />
                  </View>
                ) : null}
              </View>
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Status({ sent }: { sent: number }) {
  return sent
    ? <Text style={styles.sent}>отправлено, ждёт разбора в WireMap</Text>
    : <Text style={styles.waiting}>ждёт отправки</Text>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 10,
  },
  main: { fontSize: 16, fontWeight: '600', color: colors.text },
  sent: { fontSize: 13, color: colors.ok, marginTop: 2 },
  waiting: { fontSize: 13, color: colors.warn, marginTop: 2 },
});
