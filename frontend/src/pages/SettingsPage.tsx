import { useState } from 'react';
import {
  Alert, Button, Card, Checkbox, Group, NumberInput, Stack, Text, TextInput, Title,
} from '@mantine/core';
import {
  usePasswordPolicy, useUpdatePasswordPolicy, usePrinterSettings, useUpdatePrinterSettings,
} from '../api/hooks';
import { notifyError, notifySuccess } from '../lib/notify';
import type { PasswordPolicyOut, PrinterSettingsOut } from '../api/types';

/** Настройки, которые меняет администратор на ходу — в отличие от
 * переменных окружения (`.env`), эти правятся без перезапуска.
 *
 * Разделов два: политика паролей и адрес принтера этикеток. Общего у них
 * только место на экране и форма хранения (таблица из одной строки) —
 * содержание разное, поэтому и формы, и таблицы в базе разные.
 */
export function SettingsPage() {
  const { data: policy, isLoading: policyLoading, error: policyError } = usePasswordPolicy();
  const { data: printer, isLoading: printerLoading, error: printerError } = usePrinterSettings();

  return (
    <Stack>
      <Title order={2}>Настройки</Title>
      <Text c="dimmed" size="sm">
        Меняются здесь, а не в конфигурации сервера, — правки применяются сразу, без перезапуска.
      </Text>

      {policyError && <Alert color="red">{(policyError as Error).message}</Alert>}
      {policyLoading && <Text c="dimmed">Загрузка…</Text>}
      {/* key на версии: после сохранения хук перечитает политику под новым
          номером правки, и форма пересоздастся с уже сохранёнными
          значениями — без ручной синхронизации состояния с ответом сервера.
          Имя настройки в ключе — потому что соседей двое и номер правки у
          них свой: на свежей базе обе первой версии, и React ругался на
          двух детей с ключом «1». */}
      {policy && <PasswordPolicyForm key={`policy-${policy.version}`} policy={policy} />}

      {printerError && <Alert color="red">{(printerError as Error).message}</Alert>}
      {printerLoading && <Text c="dimmed">Загрузка…</Text>}
      {printer && <PrinterSettingsForm key={`printer-${printer.version}`} settings={printer} />}
    </Stack>
  );
}

function PasswordPolicyForm({ policy }: { policy: PasswordPolicyOut }) {
  const [minLength, setMinLength] = useState(policy.min_length);
  const [expires, setExpires] = useState(policy.max_age_days != null);
  const [maxAgeDays, setMaxAgeDays] = useState(policy.max_age_days ?? 90);
  const update = useUpdatePasswordPolicy();

  const invalidLength = typeof minLength !== 'number' || minLength < 8 || minLength > 128;
  const invalidAge = expires && (typeof maxAgeDays !== 'number' || maxAgeDays < 1);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (invalidLength || invalidAge) return;
    update.mutate(
      {
        version: policy.version,
        min_length: minLength as number,
        max_age_days: expires ? (maxAgeDays as number) : null,
      },
      { onSuccess: () => notifySuccess('Политика паролей сохранена'), onError: notifyError },
    );
  }

  return (
    <Card withBorder padding="md" maw={480} component="form" onSubmit={handleSubmit}>
      <Stack>
        <Title order={4}>Политика паролей</Title>
        <NumberInput
          label="Минимальная длина"
          description="Действует при создании учётной записи, смене и сбросе пароля"
          value={minLength}
          onChange={(v) => setMinLength(v === '' ? ('' as unknown as number) : Number(v))}
          min={8} max={128} required
          error={invalidLength ? 'От 8 до 128 символов' : null}
        />
        <Checkbox
          label="Требовать смену пароля по сроку"
          checked={expires}
          onChange={(e) => setExpires(e.currentTarget.checked)}
        />
        {expires && (
          <NumberInput
            label="Через сколько дней"
            description="Считается от последней смены пароля"
            value={maxAgeDays}
            onChange={(v) => setMaxAgeDays(v === '' ? ('' as unknown as number) : Number(v))}
            min={1} required
            error={invalidAge ? 'Не меньше 1 дня' : null}
          />
        )}
        <Text size="xs" c="dimmed">
          Кто не сменит пароль вовремя — при следующем действии в системе увидит форму смены
          пароля вместо обычной работы.
        </Text>
        <Group justify="flex-end">
          <Button type="submit" loading={update.isPending} disabled={invalidLength || invalidAge}>
            Сохранить
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

function PrinterSettingsForm({ settings }: { settings: PrinterSettingsOut }) {
  const [host, setHost] = useState(settings.host ?? '');
  const [port, setPort] = useState(settings.port);
  const update = useUpdatePrinterSettings();

  const trimmedHost = host.trim();
  const invalidPort = typeof port !== 'number' || port < 1 || port > 65535;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (invalidPort) return;
    update.mutate(
      { version: settings.version, host: trimmedHost || null, port: port as number },
      { onSuccess: () => notifySuccess('Настройки принтера сохранены'), onError: notifyError },
    );
  }

  return (
    <Card withBorder padding="md" maw={480} component="form" onSubmit={handleSubmit}>
      <Stack>
        <Title order={4}>Принтер этикеток</Title>
        <Text size="xs" c="dimmed">
          Термотрансферный принтер Godex G530 по сети (порт 9100). Один принтер на цех — адрес
          указывается здесь один раз, печать с карточки устройства использует его без переспроса.
        </Text>
        <TextInput
          label="Адрес принтера"
          description="IP-адрес или сетевое имя. Пусто — печать недоступна, пока не указан"
          placeholder="10.10.9.50"
          value={host}
          onChange={(e) => setHost(e.currentTarget.value)}
        />
        <NumberInput
          label="Порт"
          value={port}
          onChange={(v) => setPort(v === '' ? ('' as unknown as number) : Number(v))}
          min={1} max={65535} required
          error={invalidPort ? 'От 1 до 65535' : null}
        />
        <Group justify="flex-end">
          <Button type="submit" loading={update.isPending} disabled={invalidPort}>
            Сохранить
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
