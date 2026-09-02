/**
 * Спецификация из снимка — то, с чем ходят по цеху.
 *
 * Поиск делает база, а не перебор в памяти: на площадке в тысячу устройств
 * перебирать на каждую букву заметно даже глазом.
 */

import { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { searchDevices } from '../db/database';
import type { DeviceOut } from '../api/types';
import {
  Button, Dim, Divider, Empty, Group, ListRow, PageHeader, Paper, Screen, SearchField, dash, space,
} from '../ui';
import type { SpecStackParams } from '../navigation/types';

type Props = NativeStackScreenProps<SpecStackParams, 'Devices'>;

/** Столько строк отдаёт база за раз. Показываем это человеку, когда упёрлись:
 * иначе непонятно, почему нужного устройства не видно. */
const LIMIT = 100;

export function DevicesScreen({ navigation }: Props) {
  const [query, setQuery] = useState('');
  const [devices, setDevices] = useState<DeviceOut[]>([]);

  const load = useCallback(async (text: string) => {
    setDevices(await searchDevices(text, LIMIT));
  }, []);

  // Задержка, чтобы не бить в базу на каждую букву.
  useEffect(() => {
    const timer = setTimeout(() => { void load(query); }, 250);
    return () => clearTimeout(timer);
  }, [query, load]);

  // Вернулись с экрана добавления — список мог измениться.
  useFocusEffect(useCallback(() => { void load(query); }, [load, query]));

  return (
    <Screen>
      <PageHeader title="Устройства" count={devices.length}>
        <Button
          title="Связь" variant="light" icon="plus" size="sm"
          onPress={() => navigation.navigate('AddLink', {})}
        />
        <Button
          title="Устройство" icon="plus" size="sm"
          onPress={() => navigation.navigate('AddDevice')}
        />
      </PageHeader>

      <View style={{ marginBottom: space.lg }}>
        <SearchField value={query} onChangeText={setQuery} placeholder="Код, название…" />
      </View>

      {devices.length === 0 ? (
        <Empty icon="database">
          {query
            ? 'Ничего не нашлось. Если такого устройства в спецификации нет — заведите его кнопкой «Устройство».'
            : 'Снимок пуст. Загрузите его в офисе, на вкладке «Обмен».'}
        </Empty>
      ) : (
        <Paper padding="none" style={{ flex: 1 }}>
          <FlatList
            data={devices}
            keyExtractor={(item) => String(item.id)}
            ItemSeparatorComponent={Divider}
            renderItem={({ item }) => (
              <ListRow
                first
                title={item.code}
                subtitle={dash(item.name)}
                meta={`портов: ${item.interfaces?.length ?? 0}`}
                onPress={() => navigation.navigate('Device', { id: item.id })}
              />
            )}
            ListFooterComponent={devices.length === LIMIT ? (
              <Group justify="start" style={{ padding: space.md }}>
                <Dim size="xs">{`Показаны первые ${LIMIT} — уточните поиск.`}</Dim>
              </Group>
            ) : null}
          />
        </Paper>
      )}
    </Screen>
  );
}
