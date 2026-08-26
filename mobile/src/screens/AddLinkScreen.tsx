/**
 * Кабель, найденный в цеху.
 *
 * Экран открывается двумя путями, и это важно:
 * - от гнезда в карточке устройства — тогда конец A уже подставлен, и
 *   вместе с ним уезжает номер устройства из снимка. В офисе такой конец
 *   опознаётся точно, а не угадыванием по тексту;
 * - с пустого места — тогда оба конца пишутся руками, как видит человек.
 *
 * Ни устройства, ни гнёзда здесь не выбираются из списка: второй конец
 * кабеля часто вообще не заведён в WireMap — ради него в цех и пошли.
 * Список бы такую находку просто не дал записать.
 */

import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { queueLink } from '../db/queue';
import { useAppState } from '../state';
import { Button, Card, Dim, Field, Notice, Screen, Title } from '../ui';
import type { RootStackParams } from '../App';

type Props = NativeStackScreenProps<RootStackParams, 'AddLink'>;

export function AddLinkScreen({ route, navigation }: Props) {
  const { aDeviceId, aDeviceText, aPortText } = route.params ?? {};
  const { refresh } = useAppState();

  const [aDevice, setADevice] = useState(aDeviceText ?? '');
  const [aPort, setAPort] = useState(aPortText ?? '');
  const [bDevice, setBDevice] = useState('');
  const [bPort, setBPort] = useState('');
  const [medium, setMedium] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Кабель без обоих концов записывать бессмысленно: в офисе из такой
  // строки не выйдет ни одной связи.
  const canSave = aDevice.trim().length > 0 && bDevice.trim().length > 0;

  async function handleSave() {
    setSaving(true);
    try {
      await queueLink({
        a_device_text: aDevice.trim() || null,
        a_port_text: aPort.trim() || null,
        b_device_text: bDevice.trim() || null,
        b_port_text: bPort.trim() || null,
        // Номер устройства сохраняется, только если конец пришёл из
        // снимка: угаданному по тексту здесь взяться неоткуда.
        a_device_id: aDeviceId ?? null,
        b_device_id: null,
        medium: medium.trim() || null,
        notes: notes.trim() || null,
      });
      await refresh();
      navigation.goBack();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Card>
          <Title>Нашёл кабель</Title>
          <Dim>
            Запишите оба конца так, как видите: подпись на железке и номер гнезда. Опознавать будут в офисе.
          </Dim>
          {aDeviceId != null ? (
            <View style={{ marginTop: 10 }}>
              <Notice kind="ok">Конец A взят из спецификации — в офисе опознается точно.</Notice>
            </View>
          ) : null}
        </Card>

        <Card>
          <Title>Конец A</Title>
          <Field label="Устройство" value={aDevice} onChangeText={setADevice} placeholder="SW-0001 или «свитч у окна»" />
          <Field label="Гнездо" value={aPort} onChangeText={setAPort} placeholder="3 или Gi0/3" autoCapitalize="none" />
        </Card>

        <Card>
          <Title>Конец B</Title>
          <Field label="Устройство" value={bDevice} onChangeText={setBDevice} placeholder="камера над воротами" />
          <Field label="Гнездо" value={bPort} onChangeText={setBPort} placeholder="eth0" autoCapitalize="none" />
        </Card>

        <Card>
          <Field label="Среда" hint="медь, оптика — если видно" value={medium} onChangeText={setMedium} />
          <Field label="Заметка" value={notes} onChangeText={setNotes} multiline />
          {!canSave ? (
            <Notice kind="warn">Нужны оба конца — иначе связь в офисе не собрать.</Notice>
          ) : null}
          <Button title="Сохранить" onPress={handleSave} busy={saving} disabled={!canSave} />
          <Dim>Сохраняется на телефон. Уедет в WireMap, когда вернётесь в офис.</Dim>
        </Card>
      </ScrollView>
    </Screen>
  );
}
