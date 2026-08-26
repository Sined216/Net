/**
 * Список устройств из снимка. Работает без сети — всё уже на телефоне.
 *
 * Поиск отдан базе, а не перебору в памяти: на площадке в тысячу железок
 * фильтровать массив на каждую букву — заметная задержка на телефоне.
 */

import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { searchDevices } from '../db/database';
import type { DeviceOut } from '../api/types';
import { Button, Dim, Notice, Screen, colors } from '../ui';
import type { RootStackParams } from '../App';

type Props = NativeStackScreenProps<RootStackParams, 'Devices'>;

export function DevicesScreen({ navigation }: Props) {
  const [query, setQuery] = useState('');
  const [devices, setDevices] = useState<DeviceOut[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (text: string) => {
    setLoading(true);
    try {
      setDevices(await searchDevices(text));
    } finally {
      setLoading(false);
    }
  }, []);

  // Пауза перед запросом: иначе база опрашивается на каждое нажатие, и
  // список дёргается быстрее, чем человек успевает дописать слово.
  useEffect(() => {
    const timer = setTimeout(() => { void load(query); }, 250);
    return () => clearTimeout(timer);
  }, [query, load]);

  return (
    <Screen>
      <TextInput
        style={styles.search}
        value={query} onChangeText={setQuery}
        placeholder="Код, название…" placeholderTextColor={colors.dim}
        autoCapitalize="none"
      />
      <View style={styles.actions}>
        <Button title="+ Устройство" onPress={() => navigation.navigate('AddDevice')} />
        <Button title="+ Связь" kind="secondary" onPress={() => navigation.navigate('AddLink', {})} />
      </View>

      {!loading && devices.length === 0 ? (
        <Notice kind="warn">
          {query.trim()
            ? 'Ничего не нашлось. Если такого устройства в спецификации нет — заведите его кнопкой «+ Устройство».'
            : 'Снимок пуст. Загрузите его в офисе на главном экране.'}
        </Notice>
      ) : null}

      <FlatList
        data={devices}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
            onPress={() => navigation.navigate('Device', { id: item.id })}
          >
            <Text style={styles.code}>{item.code}</Text>
            <Text style={styles.name}>{item.name || '—'}</Text>
            <Dim>{`портов: ${item.interfaces?.length ?? 0}`}</Dim>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: '#fff',
    minHeight: 52, paddingHorizontal: 12, fontSize: 17, color: colors.text, marginBottom: 10,
  },
  actions: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  item: {
    backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: colors.border,
  },
  itemPressed: { opacity: 0.7 },
  code: { fontSize: 17, fontWeight: '700', color: colors.text },
  name: { fontSize: 16, color: colors.text, marginTop: 2 },
});
