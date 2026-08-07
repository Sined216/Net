import { notifications } from '@mantine/notifications';

export function notifyError(e: unknown) {
  notifications.show({
    color: 'red',
    title: 'Ошибка',
    message: e instanceof Error ? e.message : String(e),
    autoClose: 5000,
  });
}

export function notifySuccess(message: string) {
  notifications.show({ color: 'green', message, autoClose: 2500 });
}
