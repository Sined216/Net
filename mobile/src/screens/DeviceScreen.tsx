/**
 * Карточка устройства из снимка — то, ради чего в цех и идут: сверить, что
 * записано в WireMap, с тем, что видно на месте.
 *
 * У каждого гнезда показано, занято ли оно **по документации** и чем
 * именно. Это и есть предмет сверки: в шкафу кабель воткнут, а в базе
 * порт свободен — значит, связь не задокументирована, и её отмечают
 * кнопкой прямо у этого гнезда.
 */

import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  readDevice, readInterfaces, readLinksForInterfaces, readTemplateName,
} from '../db/database';
import type { DeviceOut, InterfaceOut, LinkOut } from '../api/types';
import {
  Badge, Button, Dim, Empty, Group, ListRow, Paper, Screen, Stack, Text, Title, dash, space,
} from '../ui';
import type { SpecStackParams } from '../navigation/types';

type Props = NativeStackScreenProps<SpecStackParams, 'Device'>;

interface PortRow {
  iface: InterfaceOut;
  link: LinkOut | null;
}

export function DeviceScreen({ route, navigation }: Props) {
  const { id } = route.params;
  const [device, setDevice] = useState<DeviceOut | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [ports, setPorts] = useState<PortRow[]>([]);

  const load = useCallback(async () => {
    const found = await readDevice(id);
    setDevice(found);
    setTemplateName(found ? await readTemplateName(found.template_id) : null);

    const ifaces = await readInterfaces(id);
    const links = await readLinksForInterfaces(ifaces.map((i) => i.id));
    setPorts(ifaces.map((iface) => ({ iface, link: links.get(iface.id) ?? null })));
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // В шапке — код устройства, а не слово «Устройство»: так видно, куда зашёл.
  useEffect(() => {
    if (device) navigation.setOptions({ title: device.code });
  }, [device, navigation]);

  if (!device) {
    return (
      <Screen>
        <Empty icon="database">Устройство не найдено в снимке.</Empty>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <Paper>
          <Stack gap="md">
            <View>
              <Title order={3}>{device.code}</Title>
              <Text size="md">{dash(device.name)}</Text>
            </View>
            <Group gap="xl" wrap align="start">
              <Fact label="Модель">{dash(templateName)}</Fact>
              <Fact label="Адрес" mono>{dash(device.management_ip)}</Fact>
              <Fact label="MAC" mono>{dash(device.mac)}</Fact>
              {/* Уже в снимке, отдельного запроса не нужно: DeviceOut несёт
                  готовое имя группы, а не только id, — см. backend/app/
                  serialize.py. Телефону негде хранить список групп, чтобы
                  искать по нему самому. */}
              <Fact label="Группа">{dash(device.topology_group_name)}</Fact>
            </Group>
            {device.notes ? <Text size="sm">{device.notes}</Text> : null}
          </Stack>
        </Paper>

        <Stack gap="sm">
          <Group justify="space-between">
            <Title order={4}>{`Порты (${ports.length})`}</Title>
          </Group>
          <Dim size="xs">
            Показано так, как записано в WireMap. Расходится с тем, что в шкафу, — отметьте связь.
          </Dim>

          {ports.length === 0 ? (
            <Empty icon="inbox">У этого устройства в снимке нет портов.</Empty>
          ) : (
            <Paper padding="none">
              {ports.map(({ iface, link }, index) => {
                const other = describeOtherEnd(link, iface.id);
                return (
                  <ListRow
                    key={iface.id}
                    first={index === 0}
                    title={iface.label}
                    subtitle={other ? `занят: ${other}` : undefined}
                    badges={other
                      ? <Badge color="gray">занят</Badge>
                      : <Badge color="green">свободен по документации</Badge>}
                    right={other ? undefined : (
                      <Button
                        title="Есть кабель" variant="light" icon="link-2" size="sm"
                        onPress={() => navigation.navigate('AddLink', {
                          aDeviceId: device.id,
                          aDeviceText: device.code,
                          aPortText: iface.label,
                        })}
                      />
                    )}
                  />
                );
              })}
            </Paper>
          )}
        </Stack>
      </ScrollView>
    </Screen>
  );
}

/** Пара «подпись — значение», как в карточке устройства на сайте. */
function Fact({ label, children, mono }: { label: string; children: string; mono?: boolean }) {
  return (
    <View>
      <Dim size="xs">{label}</Dim>
      <Text size="sm" mono={mono}>{children}</Text>
    </View>
  );
}

/** Что на том конце кабеля — подписью, как её видит человек.
 *
 * Конец может быть подвешен (порт удалили, кабель остался) — тогда честно
 * говорим «второй конец не указан», а не выдумываем устройство.
 */
function describeOtherEnd(link: LinkOut | null, interfaceId: number): string | null {
  if (!link) return null;
  const far = link.interface_a_id === interfaceId ? link.end_b : link.end_a;
  if (!far) return 'второй конец не указан';
  return `${far.device_code}${far.interface_label ? ` / ${far.interface_label}` : ''}`;
}
