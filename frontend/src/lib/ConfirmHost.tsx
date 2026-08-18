import { useSyncExternalStore } from 'react';
import { Button, Group, Modal, Text } from '@mantine/core';
import { getConfirmState, resolveConfirm, subscribe } from './confirm';

/** Единственный на всё приложение хост модалки confirmAction — монтируется
 * один раз в main.tsx, рядом с Notifications. */
export function ConfirmHost() {
  const state = useSyncExternalStore(subscribe, getConfirmState);

  return (
    <Modal opened={state.opened} onClose={() => resolveConfirm(false)} title="Подтверждение" centered size="sm">
      <Text size="sm">{state.message}</Text>
      <Group justify="flex-end" mt="lg">
        <Button variant="default" onClick={() => resolveConfirm(false)}>Отмена</Button>
        <Button color={state.color} onClick={() => resolveConfirm(true)}>{state.confirmLabel}</Button>
      </Group>
    </Modal>
  );
}
