import { useState } from 'react';
import { Alert, Button, Group, Modal, PasswordInput, Stack, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useMutation } from '@tanstack/react-query';
import * as api from '../api/endpoints';
import { notifyError, notifySuccess } from '../lib/notify';
import { useAuth } from './AuthContext';

/** Столько же требует бэкенд (schemas.MIN_PASSWORD_LENGTH) — проверяем и
 * здесь, чтобы не гонять заведомо короткий пароль на сервер. */
const MIN_LENGTH = 12;

export function ChangePasswordModal({ forced, onClose }: { forced?: boolean; onClose: () => void }) {
  const { refreshUser } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');

  const changePassword = useMutation({
    mutationFn: () => api.changeOwnPassword({ current_password: current, new_password: next }),
    onSuccess: async () => {
      await refreshUser();
      notifySuccess('Пароль изменён');
      onClose();
    },
    onError: notifyError,
  });

  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const mismatch = repeat.length > 0 && next !== repeat;
  const canSubmit = current.length > 0 && next.length >= MIN_LENGTH && next === repeat;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    changePassword.mutate();
  }

  return (
    <Modal
      opened
      onClose={onClose}
      title="Смена пароля"
      // Принудительную смену нельзя закрыть мимо: пароль знает не только
      // владелец, пока он не сменён.
      withCloseButton={!forced}
      closeOnClickOutside={!forced}
      closeOnEscape={!forced}
    >
      <form onSubmit={handleSubmit}>
        <Stack>
          {forced && (
            <Alert color="yellow" icon={<IconAlertTriangle size={18} />}>
              Пароль вашей учётной записи задавал не вы, поэтому его знает кто-то ещё. Задайте свой,
              чтобы продолжить работу.
            </Alert>
          )}
          <PasswordInput
            label="Текущий пароль"
            value={current}
            onChange={(e) => setCurrent(e.currentTarget.value)}
            required
            autoFocus
          />
          <PasswordInput
            label="Новый пароль"
            description={`Не короче ${MIN_LENGTH} символов`}
            value={next}
            onChange={(e) => setNext(e.currentTarget.value)}
            error={tooShort ? `Слишком короткий — нужно не меньше ${MIN_LENGTH} символов` : null}
            required
          />
          <PasswordInput
            label="Новый пароль ещё раз"
            value={repeat}
            onChange={(e) => setRepeat(e.currentTarget.value)}
            error={mismatch ? 'Пароли не совпадают' : null}
            required
          />
          <Text size="xs" c="dimmed">
            Длинная фраза надёжнее короткого набора символов со спецзнаками.
          </Text>
          <Group justify="flex-end">
            {!forced && (
              <Button variant="subtle" onClick={onClose}>
                Отмена
              </Button>
            )}
            <Button type="submit" loading={changePassword.isPending} disabled={!canSubmit}>
              Сменить пароль
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
