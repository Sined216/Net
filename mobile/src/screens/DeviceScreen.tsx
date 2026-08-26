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
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { readDevice, readInterfaces, readLinkForInterface, readTemplateName } from '../db/database';
import type { DeviceOut, InterfaceOut, LinkOut } from '../api/types';
import { Button, Card, Dim, Screen, Title, colors } from '../ui';
import type { RootStackParams } from '../App';

type Props = NativeStackScreenProps<RootStackParams, 'Device'>;

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
    const rows: PortRow[] = [];
    for (const iface of ifaces) {
      rows.push({ iface, link: await readLinkForInterface(iface.id) });
    }
    setPorts(rows);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (!device) {
    return <Screen><Dim>Устройство не найдено в снимке.</Dim></Screen>;
  }

  return (
    <Screen>
      <ScrollView>
        <Card>
          <Title>{device.code}</Title>
          <Text style={styles.name}>{device.name || '—'}</Text>
          <Dim>{`модель: ${templateName ?? '—'}`}</Dim>
          {device.management_ip ? <Dim>{`адрес: ${device.management_ip}`}</Dim> : null}
          {device.mac ? <Dim>{`MAC: ${device.mac}`}</Dim> : null}
          {device.notes ? <Text style={styles.notes}>{device.notes}</Text> : null}
        </Card>

        <Card>
          <Title>{`Порты (${ports.length})`}</Title>
          <Dim>Показано так, как записано в WireMap. Расходится с тем, что в шкафу, — отметьте связь.</Dim>
          {ports.map(({ iface, link }) => {
            const other = describeOtherEnd(link, iface.id);
            return (
              <View key={iface.id} style={styles.port}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.portLabel}>{iface.label}</Text>
                  {other ? (
                    <Text style={styles.busy}>{`занят: ${other}`}</Text>
                  ) : (
                    <Text style={styles.free}>свободен по документации</Text>
                  )}
                </View>
                {!other ? (
                  <View style={{ width: 130 }}>
                    <Button
                      title="Есть кабель" kind="secondary"
                      onPress={() => navigation.navigate('AddLink', {
                        aDeviceId: device.id,
                        aDeviceText: device.code,
                        aPortText: iface.label,
                      })}
                    />
                  </View>
                ) : null}
              </View>
            );
          })}
        </Card>
      </ScrollView>
    </Screen>
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

const styles = StyleSheet.create({
  name: { fontSize: 17, color: colors.text, marginBottom: 6 },
  notes: { fontSize: 15, color: colors.text, marginTop: 8 },
  port: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 10,
  },
  portLabel: { fontSize: 16, fontWeight: '600', color: colors.text },
  busy: { fontSize: 14, color: colors.dim, marginTop: 2 },
  free: { fontSize: 14, color: colors.ok, marginTop: 2 },
});
