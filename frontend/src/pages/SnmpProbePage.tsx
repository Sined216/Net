import { useMemo, useState } from 'react';
import {
  Alert, Badge, Button, Card, Group, NumberInput, Paper, Select, Stack,
  Table, Text, TextInput, Title, Tree, useTree,
} from '@mantine/core';
import type { RenderTreeNodePayload, TreeNodeData } from '@mantine/core';
import {
  IconAlertTriangle, IconChevronDown, IconChevronRight, IconCheck, IconListTree, IconRouter, IconX,
} from '@tabler/icons-react';
import { useSnmpProbe, useSnmpWalk } from '../api/hooks';
import { useCan } from '../auth/permissions';
import { notifyError } from '../lib/notify';
import type {
  SnmpAuthProtocol, SnmpPrivProtocol, SnmpRawOid, SnmpSecurityLevel, SnmpTraceStep, SnmpVersion,
} from '../api/types';

interface OidTreeNode {
  fullOid: string;
  segment: string;
  children: OidTreeNode[];
  leaf?: SnmpRawOid;
}

/** Собранные OID приходят плоским списком в порядке обхода (лексикографический
 * порядок дерева MIB) — списком их и читать неудобно: каждое значение тонет
 * среди десятка компонентов общего для всех префикса. Строит из них дерево и
 * сворачивает цепочки узлов с единственным ребёнком в одну строку — иначе на
 * глубину OID в 10-11 компонентов пришлось бы столько же вложенных уровней
 * ради одного значения. Останавливает свёртку узел с настоящим значением
 * (лист) или точка ветвления (больше одного ребёнка) — так группы вроде
 * «1.3.6.1.2.1.2.2.1.5» (колонка ifSpeed целиком) видны одной строкой, а
 * порт 1 и порт 2 под ней — двумя раскрывающимися листьями. */
function buildOidTree(oids: SnmpRawOid[]): OidTreeNode[] {
  interface RawNode { children: Map<string, RawNode>; leaf?: SnmpRawOid }
  const root: RawNode = { children: new Map() };
  for (const o of oids) {
    let node = root;
    for (const part of o.oid.split('.')) {
      let next = node.children.get(part);
      if (!next) {
        next = { children: new Map() };
        node.children.set(part, next);
      }
      node = next;
    }
    node.leaf = o;
  }

  function compress(node: RawNode, prefix: string[]): OidTreeNode[] {
    const result: OidTreeNode[] = [];
    for (const [key, child] of node.children) {
      const segParts = [key];
      let cur = child;
      while (!cur.leaf && cur.children.size === 1) {
        const [[onlyKey, onlyChild]] = cur.children;
        segParts.push(onlyKey);
        cur = onlyChild;
      }
      const fullOid = [...prefix, ...segParts].join('.');
      result.push({
        fullOid, segment: segParts.join('.'), leaf: cur.leaf,
        children: compress(cur, [...prefix, ...segParts]),
      });
    }
    return result;
  }

  return compress(root, []);
}

function toTreeData(nodes: OidTreeNode[]): TreeNodeData[] {
  return nodes.map((n) => ({
    value: n.fullOid,
    label: n.segment,
    nodeProps: { oidNode: n },
    children: n.children.length > 0 ? toTreeData(n.children) : undefined,
  }));
}

function renderOidNode({ node, expanded, hasChildren, elementProps }: RenderTreeNodePayload) {
  const data = node.nodeProps?.oidNode as OidTreeNode | undefined;
  const leaf = data?.leaf;
  return (
    <Group gap={6} wrap="nowrap" py={3} {...elementProps} style={{ ...elementProps.style, cursor: hasChildren ? 'pointer' : 'default' }}>
      <span style={{ width: 14, flexShrink: 0, display: 'flex' }}>
        {hasChildren && (expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />)}
      </span>
      <Text size="sm" ff="monospace" fw={leaf ? 400 : 600}>{data?.segment}</Text>
      {!leaf && data && data.children.length > 0 && (
        <Text size="xs" c="dimmed">({data.children.length})</Text>
      )}
      {leaf && (
        <>
          <Badge size="xs" variant="light" color="gray">{leaf.type}</Badge>
          <Text size="xs" c="dimmed">{leaf.module}</Text>
          <Text size="sm" ff="monospace" style={{ wordBreak: 'break-word' }}>
            {leaf.value || <Text span c="dimmed">—</Text>}
          </Text>
        </>
      )}
    </Group>
  );
}

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

// Простая проверка формы OID на глаз — окончательное слово всё равно за
// схемой на бэкенде, это только чтобы не гонять заведомо кривой ввод по сети.
const OID_PATTERN = /^\.?\d+(\.\d+)+$/;

/** Скорость порта в понятных единицах — ifSpeed/ifHighSpeed приходят
 * битами в секунду, и «1000000000» ничего не говорит на глаз. */
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
 *
 * По прямой просьбе «вытащить всё, что можно» опрос читает не только
 * системную группу и порты, а ещё IP-адреса, ARP- и MAC-таблицы, VLAN на
 * портах — и рядом отдельной кнопкой стоит совсем прямой инструмент:
 * сырой обход произвольной ветки дерева MIB без разбора по полям.
 */
export function SnmpProbePage() {
  const canEdit = useCan('edit');
  const probe = useSnmpProbe();
  const walk = useSnmpWalk();
  const oidTree = useTree();

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

  const [rootOid, setRootOid] = useState('1.3.6.1');

  const isV3 = version === 'v3';
  const needsAuth = isV3 && securityLevel !== 'noAuthNoPriv';
  const needsPriv = isV3 && securityLevel === 'authPriv';

  const canSubmit = host.trim().length > 0 && port !== ''
    && (isV3 ? username.trim().length > 0 : community.trim().length > 0)
    && (!needsAuth || authPassword.length > 0)
    && (!needsPriv || privPassword.length > 0);
  const canWalk = canSubmit && OID_PATTERN.test(rootOid.trim());

  /** Общие для /probe и /walk поля подключения — версия, учётные данные —
   * собираются один раз, дальше к ним добавляется только то, что у ручек
   * своё. */
  function connectionParams() {
    return {
      host: host.trim(), version,
      community: isV3 ? undefined : community.trim(),
      username: isV3 ? username.trim() : undefined,
      security_level: securityLevel,
      auth_protocol: needsAuth ? authProtocol ?? undefined : undefined,
      auth_password: needsAuth ? authPassword : undefined,
      priv_protocol: needsPriv ? privProtocol ?? undefined : undefined,
      priv_password: needsPriv ? privPassword : undefined,
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || typeof port !== 'number') return;
    probe.mutate({ ...connectionParams(), port }, { onError: notifyError });
  }

  function handleWalk() {
    if (!canWalk || typeof port !== 'number') return;
    walk.mutate({ ...connectionParams(), port, root_oid: rootOid.trim() }, { onError: notifyError });
  }

  const result = probe.data;
  const walkResult = walk.data;
  // Обе ручки отвечают 200 и на удачу, и на неудачу опроса — «устройство не
  // ответило» видно в теле, а не в статусе. probe.isError/walk.isError
  // остаются на случай настоящего сбоя сервера (сеть до самого бэкенда,
  // 5xx и т. п.).
  const oidTreeData = useMemo(() => toTreeData(buildOidTree(walkResult?.oids ?? [])), [walkResult]);

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
        <Stack maw={1100}>
          <Text size="xs" c="dimmed">Опрос занял {result.elapsed_ms} мс</Text>

          {!result.ok && (
            <Alert color="red" title="Устройство не ответило так, как ожидалось">
              {result.error}
            </Alert>
          )}

          <TraceCard trace={result.trace} />

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
                <Table.ScrollContainer minWidth={1050}>
                  <Table verticalSpacing={4} highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>№</Table.Th><Table.Th>Название</Table.Th><Table.Th>Псевдоним</Table.Th>
                        <Table.Th>Тип</Table.Th><Table.Th>Скорость</Table.Th><Table.Th>MTU</Table.Th>
                        <Table.Th>MAC</Table.Th><Table.Th>VLAN</Table.Th>
                        <Table.Th w={120}>Админ.</Table.Th><Table.Th w={150}>Рабочее состояние</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {result.interfaces.map((iface) => (
                        <Table.Tr key={iface.index}>
                          <Table.Td>{iface.index}</Table.Td>
                          <Table.Td>
                            <Text size="sm">{iface.descr ?? iface.name ?? '—'}</Text>
                            {iface.name && iface.descr && iface.name !== iface.descr && (
                              <Text size="xs" c="dimmed">ifName: {iface.name}</Text>
                            )}
                          </Table.Td>
                          <Table.Td>{iface.alias ?? '—'}</Table.Td>
                          <Table.Td>{iface.type_label ?? (iface.type_raw != null ? `тип ${iface.type_raw}` : '—')}</Table.Td>
                          <Table.Td>{formatSpeed(iface.speed_bps)}</Table.Td>
                          <Table.Td>{iface.mtu ?? '—'}</Table.Td>
                          <Table.Td ff="monospace">{iface.mac ?? '—'}</Table.Td>
                          <Table.Td>{iface.vlan ?? '—'}</Table.Td>
                          <Table.Td style={{ whiteSpace: 'nowrap' }}>
                            {iface.admin_status
                              ? <Badge size="sm" variant="light" color={STATUS_COLOR[iface.admin_status] ?? 'orange'}>{iface.admin_status}</Badge>
                              : '—'}
                          </Table.Td>
                          <Table.Td style={{ whiteSpace: 'nowrap' }}>
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

          {result.ok && (
            <Card withBorder padding="sm">
              <Title order={5} mb="xs">IP-адреса (IP-MIB::ipAddrTable)</Title>
              {result.ip_addresses.length === 0 ? (
                <Text c="dimmed" size="sm">Устройство не отдало ни одного IP-адреса (или не поддерживает эту таблицу).</Text>
              ) : (
                <Table.ScrollContainer minWidth={500}>
                  <Table verticalSpacing={4} highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Адрес</Table.Th><Table.Th>Маска</Table.Th><Table.Th>Порт</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {result.ip_addresses.map((a, i) => (
                        <Table.Tr key={i}>
                          <Table.Td ff="monospace">{a.address}</Table.Td>
                          <Table.Td ff="monospace">{a.netmask ?? '—'}</Table.Td>
                          <Table.Td>{a.if_descr ?? (a.if_index != null ? `ifIndex ${a.if_index}` : '—')}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Card>
          )}

          {result.ok && (
            <Card withBorder padding="sm">
              <Title order={5} mb="xs">ARP-таблица (IP-MIB::ipNetToMediaTable)</Title>
              <Text size="xs" c="dimmed" mb="sm">Какие MAC устройство видит за какими IP на своих портах.</Text>
              {result.arp_entries.length === 0 ? (
                <Text c="dimmed" size="sm">Пусто (или устройство не поддерживает эту таблицу).</Text>
              ) : (
                <Table.ScrollContainer minWidth={620}>
                  <Table verticalSpacing={4} highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>IP</Table.Th><Table.Th>MAC</Table.Th><Table.Th>Порт</Table.Th><Table.Th>Тип записи</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {result.arp_entries.map((a, i) => (
                        <Table.Tr key={i}>
                          <Table.Td ff="monospace">{a.ip}</Table.Td>
                          <Table.Td ff="monospace">{a.mac ?? '—'}</Table.Td>
                          <Table.Td>{a.if_descr ?? (a.if_index != null ? `ifIndex ${a.if_index}` : '—')}</Table.Td>
                          <Table.Td>{a.type_label ?? '—'}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Card>
          )}

          {result.ok && (
            <Card withBorder padding="sm">
              <Title order={5} mb="xs">MAC-таблица (BRIDGE-MIB::dot1dTpFwdTable)</Title>
              <Text size="xs" c="dimmed" mb="sm">Какие MAC-адреса выучены на каких портах.</Text>
              {result.mac_table.length === 0 ? (
                <Text c="dimmed" size="sm">Пусто (или устройство не поддерживает Bridge-MIB).</Text>
              ) : (
                <Table.ScrollContainer minWidth={560}>
                  <Table verticalSpacing={4} highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>MAC</Table.Th><Table.Th>Порт</Table.Th><Table.Th>Статус</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {result.mac_table.map((m, i) => (
                        <Table.Tr key={i}>
                          <Table.Td ff="monospace">{m.mac}</Table.Td>
                          <Table.Td>{m.if_descr ?? (m.if_index != null ? `ifIndex ${m.if_index}` : '—')}</Table.Td>
                          <Table.Td>{m.status_label ?? '—'}</Table.Td>
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

      <Paper withBorder p="md" mt="md">
        <Group gap="xs" mb="xs">
          <IconListTree size={20} />
          <Title order={4}>Обойти всё дерево MIB</Title>
        </Group>
        <Text size="sm" c="dimmed" mb="sm" maw={720}>
          Отдельное, осознанно медленное действие: сырой обход дерева OID устройства с заданного корня — без разбора
          по полям, просто то, что оно отдаёт, включая собственные (vendor-specific) ветки производителя, без
          ограничения по числу. Использует адрес и учётные данные, заполненные выше. Останавливается только по
          времени; если устройство отвечает медленно и дерево большое, можно продолжить с более узкого корня.
        </Text>
        <Group align="flex-end" mb="sm">
          <TextInput
            label="Начальный OID" description="Например, «1.3.6.1» — вся ветка internet, или «1.3.6.1.2.1» — только стандартные MIB, без собственных веток производителя"
            value={rootOid} onChange={(e) => setRootOid(e.currentTarget.value)}
            error={rootOid.trim().length > 0 && !OID_PATTERN.test(rootOid.trim()) ? 'Похоже, это не OID' : undefined}
            ff="monospace" w={320}
          />
          <Button
            leftSection={<IconListTree size={16} />}
            onClick={handleWalk} loading={walk.isPending} disabled={!canWalk || !canEdit}
          >
            Обойти
          </Button>
        </Group>

        {walk.isError && (
          <Alert color="red" mb="sm" title="Не удалось выполнить обход">
            {(walk.error as Error).message}
          </Alert>
        )}

        {walkResult && (
          <Stack>
            <Text size="xs" c="dimmed">
              Обход занял {walkResult.elapsed_ms} мс, собрано OID: {walkResult.oids.length}
              {walkResult.truncated && ' (прервано по общему времени — см. след ниже)'}
            </Text>

            {!walkResult.ok && (
              <Alert color="red" title="Обход не завершился как ожидалось">
                {walkResult.error}
              </Alert>
            )}

            <TraceCard trace={walkResult.trace} />

            {walkResult.oids.length > 0 && (
              <Card withBorder padding="sm">
                <Group justify="space-between" mb="xs">
                  <Title order={5}>Собранные OID — {walkResult.oids.length}</Title>
                  <Group gap="xs">
                    <Button size="xs" variant="subtle" onClick={() => oidTree.expandAllNodes()}>Развернуть всё</Button>
                    <Button size="xs" variant="subtle" onClick={() => oidTree.collapseAllNodes()}>Свернуть всё</Button>
                  </Group>
                </Group>
                <Text size="xs" c="dimmed" mb="sm">
                  Ветки дерева — общие префиксы OID (по ним свёрнуты цепочки без развилок); у самого значения —
                  модуль MIB, к которому оно относится (по префиксу, не по настоящему разбору MIB-файлов — для
                  частных веток производителя виден хотя бы номер).
                </Text>
                <div style={{ maxHeight: 600, overflow: 'auto' }}>
                  <Tree data={oidTreeData} tree={oidTree} renderNode={renderOidNode} withLines levelOffset={22} />
                </div>
              </Card>
            )}
          </Stack>
        )}
      </Paper>
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

/** Диагностический след — общий вид для обычного опроса и для обхода
 * дерева MIB: что делали на каждом шаге, что реально пришло, с OID, где
 * это уместно, и на чём остановились. */
function TraceCard({ trace }: { trace: SnmpTraceStep[] }) {
  if (trace.length === 0) return null;
  return (
    <Card withBorder padding="sm">
      <Title order={5} mb="xs">Диагностика</Title>
      <Text size="xs" c="dimmed" mb="sm">
        Что опрашивали на каждом шаге, что реально пришло в ответ — с OID, где это уместно.
      </Text>
      <Table.ScrollContainer minWidth={620}>
        <Table verticalSpacing={6} withRowBorders>
          <Table.Tbody>
            {trace.map((step, i) => (
              <Table.Tr key={i}>
                <Table.Td w={24} valign="top" pt={6}>
                  {step.ok
                    ? <IconCheck size={16} color="var(--mantine-color-teal-6)" />
                    : <IconX size={16} color="var(--mantine-color-red-6)" />}
                </Table.Td>
                <Table.Td w={190} valign="top"><Text size="sm" fw={500}>{step.label}</Text></Table.Td>
                <Table.Td valign="top">
                  <Text size="sm" c="dimmed" ff="monospace" style={{ whiteSpace: 'pre-line' }}>
                    {step.detail}
                  </Text>
                </Table.Td>
                <Table.Td w={80} valign="top"><Text size="xs" c="dimmed" ta="right">{step.elapsed_ms} мс</Text></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  );
}
