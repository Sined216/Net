import { useState } from 'react';
import { Alert, Badge, Button, Group, Modal, PasswordInput, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { useCreateUser, useUsers } from '../api/hooks';
import { notifyError, notifySuccess } from '../lib/notify';

const ROLE_COLOR: Record<string, string> = { admin: 'red', editor: 'blue', viewer: 'gray' };

export function UsersPage() {
  const { data: users = [], isLoading, error } = useUsers();
  const [opened, setOpened] = useState(false);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Пользователи</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setOpened(true)}>
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
            <Table.Th>Создан</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {users.map((u) => (
            <Table.Tr key={u.id}>
              <Table.Td>{u.full_name}</Table.Td>
              <Table.Td>{u.username}</Table.Td>
              <Table.Td>
                <Badge color={ROLE_COLOR[u.role]}>{u.role}</Badge>
              </Table.Td>
              <Table.Td>{new Date(u.created_at).toLocaleString('ru-RU')}</Table.Td>
            </Table.Tr>
          ))}
          {!isLoading && users.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={4}>
                <Text c="dimmed">Пользователей нет</Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      {opened && <UserFormModal onClose={() => setOpened(false)} />}
    </Stack>
  );
}

function UserFormModal({ onClose }: { onClose: () => void }) {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<string>('viewer');
  const createUser = useCreateUser();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createUser.mutate(
      { full_name: fullName.trim(), username: username.trim(), password, role },
      { onSuccess: () => { notifySuccess('Пользователь создан'); onClose(); }, onError: notifyError },
    );
  }

  return (
    <Modal opened onClose={onClose} title="Новый пользователь">
      <form onSubmit={handleSubmit}>
        <Stack>
          <TextInput label="Имя" value={fullName} onChange={(e) => setFullName(e.currentTarget.value)} required />
          <TextInput label="Логин" value={username} onChange={(e) => setUsername(e.currentTarget.value)} required />
          <PasswordInput label="Пароль" value={password} onChange={(e) => setPassword(e.currentTarget.value)} required />
          <Select label="Роль" data={['viewer', 'editor', 'admin']} value={role} onChange={(v) => setRole(v ?? 'viewer')} />
          <Group justify="flex-end" mt="sm">
            <Button type="submit" loading={createUser.isPending}>
              Создать
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
