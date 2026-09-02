/**
 * Новое устройство, найденное в цеху.
 *
 * Ничего не проверяется и не сверяется со справочниками: модель пишется
 * так, как написано на корпусе, а есть ли такая в WireMap — выяснится при
 * разборе в офисе. Требовать точности от человека, стоящего у шкафа, —
 * верный способ получить пустые поля вместо приблизительных.
 *
 * Список моделей из снимка показан подсказкой, а не выбором из готового:
 * найти могли и то, чего в справочнике ещё нет.
 */

import { useEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { listTemplateNames } from '../db/database';
import { queueDevice } from '../db/queue';
import { useAppState } from '../state';
import {
  Alert, Button, Dim, Field, Group, Paper, Screen, Stack,
} from '../ui';
import type { AddRoutes } from '../navigation/types';

type Props = NativeStackScreenProps<AddRoutes, 'AddDevice'>;

export function AddDeviceScreen({ navigation }: Props) {
  const { refresh } = useAppState();
  const [name, setName] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [ip, setIp] = useState('');
  const [mac, setMac] = useState('');
  const [notes, setNotes] = useState('');
  const [templates, setTemplates] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { void listTemplateNames().then(setTemplates); }, []);

  const suggestions = templateName.trim().length > 0
    ? templates.filter((t) => t.toLowerCase().includes(templateName.trim().toLowerCase())).slice(0, 5)
    : [];

  // Хоть что-то опознаваемое: запись без названия и без модели в офисе
  // разобрать невозможно — непонятно даже, о чём она.
  const canSave = name.trim().length > 0 || templateName.trim().length > 0;

  async function handleSave() {
    setSaving(true);
    try {
      await queueDevice({
        name: name.trim() || null,
        template_name: templateName.trim() || null,
        management_ip: ip.trim() || null,
        mac: mac.trim() || null,
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
          Запишите, как есть. В офисе это попадёт на разбор, а не сразу в спецификацию — там и уточните.
        </Dim>

        <Paper>
          <Stack gap="lg">
            <Field
              label="Название" hint="Как называют на месте: «свитч в щитовой»"
              value={name} onChangeText={setName}
            />
            <Field
              label="Модель" hint="Как написано на корпусе"
              value={templateName} onChangeText={setTemplateName} autoCapitalize="none"
            />
            {suggestions.length > 0 ? (
              <Stack gap="sm">
                <Dim size="xs">Есть в справочнике:</Dim>
                <Group gap="sm" wrap>
                  {suggestions.map((item) => (
                    <Button
                      key={item} title={item} variant="default" size="sm"
                      onPress={() => setTemplateName(item)}
                    />
                  ))}
                </Group>
              </Stack>
            ) : null}
            <Field
              label="IP-адрес" value={ip} onChangeText={setIp}
              autoCapitalize="none" placeholder="10.10.1.5"
            />
            <Field
              label="MAC" value={mac} onChangeText={setMac}
              autoCapitalize="none" placeholder="00:11:22:33:44:55"
            />
            <Field
              label="Заметка" hint="Где стоит, что рядом, что смутило"
              value={notes} onChangeText={setNotes} multiline
            />
          </Stack>
        </Paper>

        {!canSave ? (
          <Alert color="yellow">Заполните хотя бы название или модель — иначе запись нечем опознать.</Alert>
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
