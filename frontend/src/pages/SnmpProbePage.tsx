import { useState } from 'react';
import {
  Alert, Badge, Button, Card, Group, NumberInput, Paper, Select, Stack,
  Table, Text, TextInput, Title,
} from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconRouter, IconX } from '@tabler/icons-react';
import { useSnmpProbe } from '../api/hooks';
import { useCan } from '../auth/permissions';
import { notifyError } from '../lib/notify';
import type { SnmpAuthProtocol, SnmpPrivProtocol, SnmpSecurityLevel, SnmpVersion } from '../api/types';

const VERSIONS: { value: SnmpVersion; label: string }[] = [
  { value: 'v2c', label: 'v2c — community-строка, без шифрования' },
  { value: 'v1', label: 'v1 — то же самое, старейшая версия' },
  { value: 'v3', label: 'v3 — логин и пароль, опционально с шифрованием' },
];

const SECURITY_LEVELS: { value: SnmpSecurityLevel; label: string }[] = [
  { value: 'noAuthNoPriv', label: 'без пароля и шифрования' },
  { value: 'authNoPriv', label: 'с паролем, без шифрования' },
  { value: 'authPriv', label: 'с паролем и шифрованием' },
];

const AUTH_PROTOCOLS: { value: SnmpAuthProtocol; label: string }[] =
  (['MD5', 'SHA', 'SHA224', 'SHA256', 'SHA384', 'SHA512'] as const).map((v) => ({ value: v, label: v }));
const PRIV_PROTOCOLS: { value: SnmpPrivProtocol; label: string }[] =
  (['DES', '3DES', 'AES', 'AES192', 'AES256'] as const).map((v) => ({ value: v, label: v }));

/** Скорость порта в понятных единицах — ifSpeed приходит битами в секунду,
 * и «1000000000» ничего не говорит на глаз. */
function formatSpeed(bps: number | null | undefined): string {
  if (bps == null) return '—';
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toLocaleString('ru-RU')} Гбит/с`;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toLocaleString('ru-RU')} Мбит/с`;
  if (bps >= 1_000) return `${(bps / 1_000).toLocaleString('ru-RU')} Кбит/с`;
  return `${bps} бит/с`;
}

const STATUS_COLOR: Record<string, string> = {
  включён: 'teal',
  выключен: 'gray',
};

/** Опрос устройства по SNMP — отдельная страница, ни с чем в приложении не
 * связанная: ничего не сохраняет и не привязывает к спецификации
 * оборудования. Задача — посмотреть вживую, что такое SNMP и что реальное
 * устройство по нему отдаёт, прежде чем решать, как это встраивать в
 * документирование сети (см. этап 4 ТЗ, SNMP/LLDP-опрос).
 */
export function SnmpProbePage() {
  const canEdit = useCan('edit');
  const probe = useSnmpProbe();

  const [host, setHost] = useState('');
  const [port, setPort] = useState<number | ''>(161);
  const [version, setVersion] = useState<SnmpVersion>('v2c');
  const [community, setCommunity] = useState('public');

  const [username, setUsername] = useState('');
  const [securityLevel, setSecurityLevel] = useState<SnmpSecurityLevel>('noAuthNoPriv');
  const [authProtocol, setAuthProtocol] = useState<SnmpAuthProtocol | null>('SHA');
  const [authPassword, setAuthPassword] = useState('');
  const [privProtocol, setPrivProtocol] = useState<SnmpPrivProtocol | null>('AES');
  const [privPassword, setPrivPassword] = useState('');

  const isV3 = version === 'v3';
  const needsAuth = isV3 && securityLevel !== 'noAuthNoPriv';
  const needsPriv = isV3 && securityLevel === 'authPriv';

  const canSubmit = host.trim().length > 0 && port !== ''
    && (isV3 ? username.trim().length > 0 : community.trim().length > 0)
    && (!needsAuth || authPassword.length > 0)
    && (!needsPriv || privPassword.length > 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || typeof port !== 'number') return;
    probe.mutate(
      {
        host: host.trim(), port, version,
        community: isV3 ? undefined : community.trim(),
        username: isV3 ? username.trim() : undefined,
        security_level: securityLevel,
        auth_protocol: needsAuth ? authProtocol ?? undefined : undefined,
        auth_password: needsAuth ? authPassword : undefined,
        priv_protocol: needsPriv ? privProtocol ?? undefined : undefined,
        priv_password: needsPriv ? privPassword : undefined,
      },
      { onError: notifyError },
    );
  }

  const result = probe.data;
  // Ручка отвечает 200 и на удачный, и на неудачный опрос — «устройство не
  // ответило» видно в теле, а не в статусе. probe.isError остаётся на
  // случай настоящего сбоя сервера (сеть до самого бэкенда, 5xx и т.п.).

  return (
    <Stack>
      <Group gap="xs">
        <IconRouter size={22} />
        <Title order={2}>SNMP</Title>
      </Group>
      <Text c="dimmed" size="sm" maw={720}>
        SNMP — протокол, которым сетевое и промышленное оборудование само отвечает на вопрос «кто ты и что у тебя
        есть»: имя, время работы без перезагрузки, список портов со скоростью и состоянием. Устройство слушает
        обычно порт 161/UDP и требует «пароль» — на v1/v2c это открытая community-строка (часто <code>public</code>
        для чтения), на v3 — настоящие логин и пароль, опционально с шифрованием. Эта страница отдельная и ничего не
        сохраняет: только спрашивает устройство напрямую и показывает, что оно ответило.
      </Text>

      <Paper withBorder p="md" maw={640}>
        <form onSubmit={handleSubmit}>
          <Stack>
            <Group grow>
              <TextInput
                label="Адрес" placeholder="10.10.1.5" required autoFocus
                value={host} onChange={(e) => setHost(e.currentTarget.value)}
              />
              <NumberInput
                label="Порт" value={port} onChange={(v) => setPort(v === '' ? '' : Number(v))}
                min={1} max={65535} w={120}
              />
            </Group>
            <Select
              label="Версия" data={VERSIONS} value={version}
              onChange={(v) => setVersion((v as SnmpVersion) ?? 'v2c')}
              allowDeselect={false}
            />

            {!isV3 && (
              <TextInput
                label="Community" description="Обычно «public» для чтения — так и на подавляющем большинстве оборудования из коробки"
                value={community} onChange={(e) => setCommunity(e.currentTarget.value)}
              />
            )}

            {isV3 && (
              <>
                <TextInput
                  label="Имя пользователя" required
                  value={username} onChange={(e) => setUsername(e.currentTarget.value)}
                />
                <Select
                  label="Уровень защиты" data={SECURITY_LEVELS} value={securityLevel}
                  onChange={(v) => setSecurityLevel((v as SnmpSecurityLevel) ?? 'noAuthNoPriv')}
                  allowDeselect={false}
                />
                {needsAuth && (
                  <Group grow>
                    <Select
                      label="Протокол аутентификации" data={AUTH_PROTOCOLS} value={authProtocol}
                      onChange={(v) => setAuthProtocol(v as SnmpAuthProtocol)} allowDeselect={false}
                    />
                    <TextInput
                      label="Пароль аутентификации" type="password" required
                      value={authPassword} onChange={(e) => setAuthPassword(e.currentTarget.value)}
                    />
                  </Group>
                )}
                {needsPriv && (
                  <Group grow>
                    <Select
                      label="Протокол шифрования" data={PRIV_PROTOCOLS} value={privProtocol}
                      onChange={(v) => setPrivProtocol(v as SnmpPrivProtocol)} allowDeselect={false}
                    />
                    <TextInput
                      label="Пароль шифрования" type="password" required
                      value={privPassword} onChange={(e) => setPrivPassword(e.currentTarget.value)}
                    />
                  </Group>
                )}
              </>
            )}

            {!canEdit && (
              <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
                Опрос — как правка: смотрящему недоступен.
              </Alert>
            )}

            <Group justify="flex-end">
              <Button type="submit" loading={probe.isPending} disabled={!canSubmit || !canEdit}>
                Опросить
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>

      {probe.isError && (
        <Alert color="red" maw={720} title="Не удалось выполнить опрос">
          {(probe.error as Error).message}
        </Alert>
      )}

      {result && (
        <Stack maw={900}>
          <Text size="xs" c="dimmed">Опрос занял {result.elapsed_ms} мс</Text>

          {!result.ok && (
            <Alert color="red" title="Устройство не ответило так, как ожидалось">
              {result.error}
            </Alert>
          )}

          {result.trace.length > 0 && (
            <Card withBorder padding="sm">
              <Title order={5} mb="xs">Диагностика</Title>
              <Table verticalSpacing={4} withRowBorders={false}>
                <Table.Tbody>
                  {result.trace.map((step, i) => (
                    <Table.Tr key={i}>
                      <Table.Td w={24}>
                        {step.ok
                          ? <IconCheck size={16} color="var(--mantine-color-teal-6)" />
                          : <IconX size={16} color="var(--mantine-color-red-6)" />}
                      </Table.Td>
                      <Table.Td w={220}><Text size="sm" fw={500}>{step.label}</Text></Table.Td>
                      <Table.Td><Text size="sm" c="dimmed">{step.detail}</Text></Table.Td>
                      <Table.Td w={80}><Text size="xs" c="dimmed" ta="right">{step.elapsed_ms} мс</Text></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Card>
          )}

          {result.system && (
            <Card withBorder padding="sm">
              <Title order={5} mb="xs">Системная группа</Title>
              <Table verticalSpacing={4} withRowBorders={false}>
                <Table.Tbody>
                  <SystemRow label="Имя" value={result.system.sys_name} />
                  <SystemRow label="Описание" value={result.system.sys_descr} />
                  <SystemRow label="Время работы" value={result.system.sys_up_time_text} />
                  <SystemRow label="Расположение" value={result.system.sys_location} />
                  <SystemRow label="Контакт" value={result.system.sys_contact} />
                  <SystemRow label="sysObjectID" value={result.system.sys_object_id} mono />
                </Table.Tbody>
              </Table>
            </Card>
          )}

          {result.ok && (
            <Card withBorder padding="sm">
              <Title order={5} mb="xs">Порты (IF-MIB)</Title>
              {result.interfaces.length === 0 ? (
                <Text c="dimmed" size="sm">Устройство не отдало ни одного порта.</Text>
              ) : (
                <Table.ScrollContainer minWidth={620}>
                  <Table verticalSpacing={4} highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>№</Table.Th><Table.Th>Название</Table.Th><Table.Th>Тип</Table.Th>
                        <Table.Th>Скорость</Table.Th><Table.Th>MAC</Table.Th><Table.Th>Состояние</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {result.interfaces.map((iface) => (
                        <Table.Tr key={iface.index}>
                          <Table.Td>{iface.index}</Table.Td>
                          <Table.Td>{iface.descr ?? '—'}</Table.Td>
                          <Table.Td>{iface.type_label ?? (iface.type_raw != null ? `тип ${iface.type_raw}` : '—')}</Table.Td>
                          <Table.Td>{formatSpeed(iface.speed_bps)}</Table.Td>
                          <Table.Td ff="monospace">{iface.mac ?? '—'}</Table.Td>
                          <Table.Td>
                            {iface.oper_status
                              ? <Badge size="sm" variant="light" color={STATUS_COLOR[iface.oper_status] ?? 'orange'}>{iface.oper_status}</Badge>
                              : '—'}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Card>
          )}
        </Stack>
      )}
    </Stack>
  );
}

function SystemRow({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <Table.Tr>
      <Table.Td w={140}><Text size="sm" c="dimmed">{label}</Text></Table.Td>
      <Table.Td ff={mono ? 'monospace' : undefined}>{value || <Text span c="dimmed">—</Text>}</Table.Td>
    </Table.Tr>
  );
}
