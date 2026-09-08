import { useState } from 'react';
import { Alert, Button, Group, Modal, PasswordInput, Stack, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useMutation } from '@tanstack/react-query';
import * as api from '../api/endpoints';
import { usePasswordPolicy } from '../api/hooks';
import { notifyError, notifySuccess } from '../lib/notify';
import { useAuth } from './AuthContext';

/** Пока политика не подгрузилась — прежнее значение по умолчанию: сервер
 * всё равно проверит настоящее требование, это только подсказка заранее. */
const FALLBACK_MIN_LENGTH = 12;

type ForcedReason = 'assigned' | 'expired';

export function ChangePasswordModal({ forced, reason = 'assigned', onClose }: {
  forced?: boolean; reason?: ForcedReason; onClose: () => void;
}) {
  const { refreshUser } = useAuth();
  const { data: policy } = usePasswordPolicy();
  const minLength = policy?.min_length ?? FALLBACK_MIN_LENGTH;
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

  const tooShort = next.length > 0 && next.length < minLength;
  const mismatch = repeat.length > 0 && next !== repeat;
  const canSubmit = current.length > 0 && next.length >= minLength && next === repeat;

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
              {reason === 'expired'
                ? 'Пароль не менялся дольше срока, который задал администратор. Задайте новый, чтобы продолжить работу.'
                : 'Пароль вашей учётной записи задавал не вы, поэтому его знает кто-то ещё. Задайте свой, '
                  + 'чтобы продолжить работу.'}
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
            description={`Не короче ${minLength} символов`}
            value={next}
            onChange={(e) => setNext(e.currentTarget.value)}
            error={tooShort ? `Слишком короткий — нужно не меньше ${minLength} символов` : null}
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
