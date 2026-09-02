import { useState } from 'react';
import {
  Alert, Badge, Button, Group, Modal, PasswordInput, Select, Stack, Table, Text,
  TextInput, Title,
} from '@mantine/core';
import { IconKey, IconLock, IconLockOpen, IconPlus } from '@tabler/icons-react';
import { EditAction, RowAction } from '../components/RowAction';
import {
  useCreateUser, useDeactivateUser, usePasswordPolicy, useResetUserPassword, useUpdateUser, useUsers,
} from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { notifyError, notifySuccess } from '../lib/notify';
import { confirmAction } from '../lib/confirm';
import type { UserOut, UserRole } from '../api/types';

const ROLE_COLOR: Record<string, string> = { admin: 'red', editor: 'blue', viewer: 'gray' };
const ROLES: UserRole[] = ['viewer', 'editor', 'admin'];
/** Пока политика не загрузилась — прежнее значение по умолчанию, а не
 * пустая форма без ограничения: сервер проверит настоящее требование в
 * любом случае, это только подсказка человеку до отправки. */
const FALLBACK_MIN_LENGTH = 12;

export function UsersPage() {
  const { data: users = [], isLoading, error } = useUsers();
  const { user: me } = useAuth();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserOut | null>(null);
  const [resetting, setResetting] = useState<UserOut | null>(null);
  const deactivate = useDeactivateUser();
  const update = useUpdateUser();

  async function toggleActive(user: UserOut) {
    if (user.is_active) {
      if (!(await confirmAction(`Заблокировать «${user.full_name}»? Учётная запись останется в журнале изменений, но входить и работать пользователь не сможет.`))) return;
      deactivate.mutate(user.id, { onSuccess: () => notifySuccess('Пользователь заблокирован'), onError: notifyError });
    } else {
      update.mutate(
        { id: user.id, body: { is_active: true } },
        { onSuccess: () => notifySuccess('Доступ восстановлен'), onError: notifyError },
      );
    }
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Пользователи</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
          Пользователь
        </Button>
      </Group>

      {error && <Alert color="red">{(error as Error).message}</Alert>}

      <Table withTableBorder verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Имя</Table.Th>
            <Table.Th>Логин</Table.Th>
            <Table.Th>Роль</Table.Th>
            <Table.Th>Состояние</Table.Th>
            <Table.Th>Создан</Table.Th>
            <Table.Th w={120} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {users.map((u) => (
            <Table.Tr key={u.id} opacity={u.is_active ? 1 : 0.55}>
              <Table.Td>
                {u.full_name}
                {u.id === me?.id && (
                  <Text span size="xs" c="dimmed"> — это вы</Text>
                )}
              </Table.Td>
              <Table.Td>{u.username}</Table.Td>
              <Table.Td>
                <Badge color={ROLE_COLOR[u.role]}>{u.role}</Badge>
              </Table.Td>
              <Table.Td>
                {!u.is_active ? (
                  <Badge color="gray" variant="light">заблокирован</Badge>
                ) : u.must_change_password ? (
                  <Badge color="yellow" variant="light">ждёт смены пароля</Badge>
                ) : (
                  <Text size="sm" c="dimmed">активен</Text>
                )}
              </Table.Td>
              <Table.Td>{new Date(u.created_at).toLocaleString('ru-RU')}</Table.Td>
              <Table.Td>
                <Group gap={4} wrap="nowrap">
                  <EditAction label={`Изменить имя и роль «${u.full_name}»`} onClick={() => setEditing(u)} />
                  <RowAction
                    label={`Задать новый пароль «${u.full_name}»`}
                    icon={<IconKey size={16} />}
                    onClick={() => setResetting(u)}
                  />
                  <RowAction
                    label={u.is_active ? `Заблокировать «${u.full_name}»` : `Восстановить доступ «${u.full_name}»`}
                    icon={u.is_active ? <IconLock size={16} /> : <IconLockOpen size={16} />}
                    color={u.is_active ? 'red' : 'green'}
                    // Себя блокировать нельзя — бэкенд тоже это отклонит.
                    disabled={u.is_active && u.id === me?.id}
                    onClick={() => toggleActive(u)}
                  />
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
          {!isLoading && users.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={6}>
                <Text c="dimmed">Пользователей нет</Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      <Text size="sm" c="dimmed">
        Пользователи не удаляются, а блокируются: журнал изменений ссылается на автора, и записи
        «кто менял устройство» не должны терять имя. Последнего активного администратора нельзя ни
        разжаловать, ни заблокировать.
      </Text>

      {creating && <CreateUserModal onClose={() => setCreating(false)} />}
      {editing && <EditUserModal user={editing} onClose={() => setEditing(null)} />}
      {resetting && <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />}
    </Stack>
  );
}

function CreateUserModal({ onClose }: { onClose: () => void }) {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('viewer');
  const createUser = useCreateUser();
  const { data: policy } = usePasswordPolicy();
  const minLength = policy?.min_length ?? FALLBACK_MIN_LENGTH;

  const tooShort = password.length > 0 && password.length < minLength;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createUser.mutate(
      { full_name: fullName.trim(), username: username.trim(), password, role },
      {
        onSuccess: () => {
          notifySuccess('Пользователь создан — при первом входе он сменит пароль');
          onClose();
        },
        onError: notifyError,
      },
    );
  }

  return (
    <Modal opened onClose={onClose} title="Новый пользователь">
      <form onSubmit={handleSubmit}>
        <Stack>
          <TextInput label="Имя" value={fullName} onChange={(e) => setFullName(e.currentTarget.value)} required autoFocus />
          <TextInput label="Логин" value={username} onChange={(e) => setUsername(e.currentTarget.value)} required />
          <PasswordInput
            label="Временный пароль"
            description={`Не короче ${minLength} символов. Пользователь сменит его при первом входе.`}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            error={tooShort ? `Слишком короткий — нужно не меньше ${minLength} символов` : null}
            required
          />
          <Select label="Роль" data={ROLES} value={role} onChange={(v) => setRole((v as UserRole) ?? 'viewer')} />
          <Group justify="flex-end">
            <Button type="submit" loading={createUser.isPending} disabled={password.length < minLength}>
              Создать
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function EditUserModal({ user, onClose }: { user: UserOut; onClose: () => void }) {
  const [fullName, setFullName] = useState(user.full_name);
  const [role, setRole] = useState<UserRole>(user.role);
  const updateUser = useUpdateUser();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Номер правки — тот, что видели при открытии формы: см. app/versioning.py.
    updateUser.mutate(
      { id: user.id, body: { full_name: fullName.trim(), role, version: user.version } },
      { onSuccess: () => { notifySuccess('Учётная запись обновлена'); onClose(); }, onError: notifyError },
    );
  }

  return (
    <Modal opened onClose={onClose} title={`Учётная запись: ${user.username}`}>
      <form onSubmit={handleSubmit}>
        <Stack>
          <TextInput label="Имя" value={fullName} onChange={(e) => setFullName(e.currentTarget.value)} required autoFocus />
          <Select label="Роль" data={ROLES} value={role} onChange={(v) => setRole((v as UserRole) ?? 'viewer')} />
          <Text size="xs" c="dimmed">
            Смена роли действует сразу: права проверяются при каждом запросе, а не берутся из уже
            выданного токена.
          </Text>
          <Group justify="flex-end">
            <Button type="submit" loading={updateUser.isPending}>Сохранить</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: UserOut; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const resetPassword = useResetUserPassword();
  const { data: policy } = usePasswordPolicy();
  const minLength = policy?.min_length ?? FALLBACK_MIN_LENGTH;

  const tooShort = password.length > 0 && password.length < minLength;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    resetPassword.mutate(
      { id: user.id, body: { new_password: password } },
      {
        onSuccess: () => {
          notifySuccess('Пароль задан — пользователь сменит его при следующем входе');
          onClose();
        },
        onError: notifyError,
      },
    );
  }

  return (
    <Modal opened onClose={onClose} title={`Новый пароль: ${user.username}`}>
      <form onSubmit={handleSubmit}>
        <Stack>
          <PasswordInput
            label="Временный пароль"
            description={`Не короче ${minLength} символов`}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            error={tooShort ? `Слишком короткий — нужно не меньше ${minLength} символов` : null}
            required
            autoFocus
          />
          <Text size="xs" c="dimmed">
            Передайте пароль пользователю лично. При входе система потребует заменить его на свой.
          </Text>
          <Group justify="flex-end">
            <Button type="submit" loading={resetPassword.isPending} disabled={password.length < minLength}>
              Задать пароль
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
