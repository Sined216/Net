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
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { queueLink } from '../db/queue';
import { useAppState } from '../state';
import {
  Alert, Badge, Button, Dim, Field, Group, Paper, Screen, Stack, Title,
} from '../ui';
import type { AddRoutes } from '../navigation/types';

type Props = NativeStackScreenProps<AddRoutes, 'AddLink'>;

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
    <Screen scroll>
      <Stack>
        <Dim>
          Запишите оба конца так, как видите: подпись на железке и номер гнезда. Опознавать будут в офисе.
        </Dim>

        <Paper>
          <Stack gap="lg">
            <Group gap="sm">
              <Title order={4}>Конец A</Title>
              {/* Не зелёная плашка: то, что конец взят из снимка, — обычный
                  факт, а не успех, о котором надо кричать. */}
              {aDeviceId != null ? <Badge color="blue">из спецификации</Badge> : null}
            </Group>
            <Field label="Устройство" value={aDevice} onChangeText={setADevice} placeholder="SW-0001 или «свитч у окна»" />
            <Field label="Гнездо" value={aPort} onChangeText={setAPort} placeholder="3 или Gi0/3" autoCapitalize="none" />
          </Stack>
        </Paper>

        <Paper>
          <Stack gap="lg">
            <Title order={4}>Конец B</Title>
            <Field label="Устройство" value={bDevice} onChangeText={setBDevice} placeholder="камера над воротами" />
            <Field label="Гнездо" value={bPort} onChangeText={setBPort} placeholder="eth0" autoCapitalize="none" />
          </Stack>
        </Paper>

        <Paper>
          <Stack gap="lg">
            <Field label="Среда" hint="медь, оптика — если видно" value={medium} onChangeText={setMedium} />
            <Field label="Заметка" value={notes} onChangeText={setNotes} multiline />
          </Stack>
        </Paper>

        {!canSave ? (
          <Alert color="yellow">Нужны оба конца — иначе связь в офисе не собрать.</Alert>
        ) : null}

        <Group justify="end" gap="sm">
          <Button title="Отмена" variant="default" onPress={() => navigation.goBack()} />
          <Button
            title="Сохранить" icon="check"
            onPress={() => { void handleSave(); }}
            busy={saving} disabled={!canSave}
          />
        </Group>
        <Dim size="xs">Сохраняется на телефон. Уедет в WireMap, когда вернётесь в офис.</Dim>
      </Stack>
    </Screen>
  );
}
