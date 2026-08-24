import { Center, Loader, Modal } from '@mantine/core';
import { useDevice, useLink, useLinkTemplates } from '../../api/hooks';
import { DeviceFormModal } from '../devices/DeviceFormModal';
import { LinkFormModal } from '../links/LinkFormModal';

/** Окна схемы, открываемые по одному идентификатору.
 *
 * Схема больше не держит в памяти ни устройства со всеми их портами, ни
 * страницу кабелей — только узлы и линии. Поэтому по щелчку она знает
 * лишь номер: саму железку или кабель приносит отдельный запрос, а окно
 * появляется сразу, чтобы щелчок не выглядел как «ничего не произошло».
 */

function Loading({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <Modal opened onClose={onClose} title={title}>
      <Center py="xl"><Loader size="sm" /></Center>
    </Modal>
  );
}

export function DeviceModalById({ deviceId, onClose }: { deviceId: number; onClose: () => void }) {
  const { data: device } = useDevice(deviceId);
  if (!device) return <Loading title="Устройство" onClose={onClose} />;
  return <DeviceFormModal device={device} onClose={onClose} />;
}

export function LinkModalById({ linkId, onClose }: { linkId: number; onClose: () => void }) {
  const { data: link } = useLink(linkId);
  const { data: templates = [] } = useLinkTemplates();
  if (!link) return <Loading title="Связь" onClose={onClose} />;
  return <LinkFormModal link={link} templates={templates} onClose={onClose} />;
}
