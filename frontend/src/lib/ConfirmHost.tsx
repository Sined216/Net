import { useSyncExternalStore } from 'react';
import { Button, Group, Modal, Text } from '@mantine/core';
import { getConfirmState, resolveConfirm, subscribe } from './confirm';

/** Единственный на всё приложение хост модалки confirmAction — монтируется
 * один раз в main.tsx, рядом с Notifications. */
export function ConfirmHost() {
  const state = useSyncExternalStore(subscribe, getConfirmState);

  return (
    <Modal
      opened={state.opened} onClose={() => resolveConfirm(false)} title="Подтверждение" centered size="sm"
      // Выше обычного z-index модалок Mantine (200): confirmAction часто
      // вызывают из уже открытой формы (правка типа устройства, шаблона,
      // группы) — без этого её собственная модалка, смонтированная в DOM
      // раньше, перекрывала бы подтверждение и не пускала клики к кнопкам.
      zIndex={1000}
    >
      <Text size="sm">{state.message}</Text>
      <Group justify="flex-end" mt="lg">
        <Button variant="default" onClick={() => resolveConfirm(false)}>Отмена</Button>
        <Button color={state.color} onClick={() => resolveConfirm(true)}>{state.confirmLabel}</Button>
      </Group>
    </Modal>
  );
}
