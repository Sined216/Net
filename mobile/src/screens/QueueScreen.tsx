/**
 * Что найдено за смену и что из этого уже уехало.
 *
 * Отправленное не пропадает из списка само: пока человек не убрал его
 * кнопкой, оно остаётся отчётом о сделанном. Пропади оно сразу после
 * выгрузки — не было бы способа убедиться, что уехало именно то, что
 * записывали.
 */

import { useCallback, useState } from 'react';
import { ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  clearSent, deleteQueuedDevice, deleteQueuedLink, listQueuedDevices, listQueuedLinks,
} from '../db/queue';
import type { QueuedDevice, QueuedLink } from '../db/queue';
import { useAppState } from '../state';
import {
  Badge, Button, Dim, Empty, Group, IconButton, ListRow, PageHeader, Paper, Screen, Stack, Title,
  dash, space,
} from '../ui';
import type { QueueStackParams } from '../navigation/types';

type Props = NativeStackScreenProps<QueueStackParams, 'Queue'>;

export function QueueScreen({ navigation }: Props) {
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

  async function remove(kind: 'device' | 'link', uuid: string) {
    await (kind === 'device' ? deleteQueuedDevice(uuid) : deleteQueuedLink(uuid));
    await load();
    await refresh();
  }

  async function handleClearSent() {
    await clearSent();
    await load();
    await refresh();
  }

  const hasSent = devices.some((d) => d.sent) || links.some((l) => l.sent);
  const total = devices.length + links.length;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space.lg }}>
        <PageHeader title="Найдено" count={total || undefined}>
          <Button
            title="Связь" variant="light" icon="plus" size="sm"
            onPress={() => navigation.navigate('AddLink', {})}
          />
          <Button
            title="Устройство" variant="light" icon="plus" size="sm"
            onPress={() => navigation.navigate('AddDevice')}
          />
        </PageHeader>

        {total === 0 ? (
          <Empty icon="inbox">
            Пока ничего не отмечено. Находки появятся здесь и уедут в WireMap из офиса.
          </Empty>
        ) : (
          <Stack>
            <Dim>
              Записи попадают не в спецификацию, а на разбор: в WireMap человек переносит их по одной.
            </Dim>

            {devices.length > 0 ? (
              <Stack gap="sm">
                <Title order={4}>{`Устройства (${devices.length})`}</Title>
                <Paper padding="none">
                  {devices.map((item, index) => (
                    <ListRow
                      key={item.client_uuid}
                      first={index === 0}
                      title={item.name || item.template_name || 'без названия'}
                      meta={dash([item.template_name, item.management_ip, item.mac].filter(Boolean).join(' · '))}
                      badges={<StatusBadge sent={item.sent} />}
                      right={item.sent ? undefined : (
                        <IconButton
                          icon="trash-2" color="red"
                          label={`Убрать «${item.name || item.template_name || 'без названия'}»`}
                          onPress={() => { void remove('device', item.client_uuid); }}
                        />
                      )}
                    />
                  ))}
                </Paper>
              </Stack>
            ) : null}

            {links.length > 0 ? (
              <Stack gap="sm">
                <Title order={4}>{`Связи (${links.length})`}</Title>
                <Paper padding="none">
                  {links.map((item, index) => {
                    const title = describe(item);
                    return (
                      <ListRow
                        key={item.client_uuid}
                        first={index === 0}
                        title={title}
                        meta={item.medium ? `среда: ${item.medium}` : undefined}
                        badges={<StatusBadge sent={item.sent} />}
                        right={item.sent ? undefined : (
                          <IconButton
                            icon="trash-2" color="red" label={`Убрать «${title}»`}
                            onPress={() => { void remove('link', item.client_uuid); }}
                          />
                        )}
                      />
                    );
                  })}
                </Paper>
              </Stack>
            ) : null}

            {hasSent ? (
              <Group justify="end">
                <Button
                  title="Убрать отправленное" variant="subtle" color="red" icon="trash-2" size="sm"
                  onPress={() => { void handleClearSent(); }}
                />
              </Group>
            ) : null}
          </Stack>
        )}
      </ScrollView>
    </Screen>
  );
}

function StatusBadge({ sent }: { sent: number }) {
  return sent
    ? <Badge color="green">отправлено, ждёт разбора</Badge>
    : <Badge color="orange">ждёт отправки</Badge>;
}

function describe(item: QueuedLink): string {
  const a = `${item.a_device_text ?? '?'}${item.a_port_text ? `/${item.a_port_text}` : ''}`;
  const b = `${item.b_device_text ?? '?'}${item.b_port_text ? `/${item.b_port_text}` : ''}`;
  return `${a} → ${b}`;
}
