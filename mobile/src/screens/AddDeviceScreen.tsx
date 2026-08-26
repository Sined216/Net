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
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { listTemplateNames } from '../db/database';
import { queueDevice } from '../db/queue';
import { useAppState } from '../state';
import { Button, Card, Dim, Field, Notice, Screen, Title, colors } from '../ui';
import type { RootStackParams } from '../App';

type Props = NativeStackScreenProps<RootStackParams, 'AddDevice'>;

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
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Card>
          <Title>Нашёл устройство</Title>
          <Dim>
            Запишите, как есть. В офисе это попадёт на разбор, а не сразу в спецификацию — там и уточните.
          </Dim>
        </Card>

        <Card>
          <Field
            label="Название" hint="Как называют на месте: «свитч в щитовой»"
            value={name} onChangeText={setName}
          />
          <Field
            label="Модель" hint="Как написано на корпусе"
            value={templateName} onChangeText={setTemplateName} autoCapitalize="none"
          />
          {suggestions.length > 0 ? (
            <View style={styles.suggest}>
              <Dim>Есть в справочнике:</Dim>
              {suggestions.map((item) => (
                <Pressable key={item} onPress={() => setTemplateName(item)} style={styles.suggestItem}>
                  <Text style={styles.suggestText}>{item}</Text>
                </Pressable>
              ))}
            </View>
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

          {!canSave ? (
            <Notice kind="warn">Заполните хотя бы название или модель — иначе запись нечем опознать.</Notice>
          ) : null}
          <Button title="Сохранить" onPress={handleSave} busy={saving} disabled={!canSave} />
          <Dim>Сохраняется на телефон. Уедет в WireMap, когда вернётесь в офис.</Dim>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  suggest: { marginTop: -6, marginBottom: 14 },
  suggestItem: {
    paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#fff',
    borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginTop: 6,
  },
  suggestText: { fontSize: 16, color: colors.accent },
});
