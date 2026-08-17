import { useLayoutEffect, useRef, useState } from 'react';
import { Divider, Paper, Text, UnstyledButton } from '@mantine/core';
import {
  IconCopy, IconDeviceDesktopPlus, IconEdit, IconFolderPlus, IconLayoutGrid,
  IconPlug, IconTrash, IconUsersGroup,
} from '@tabler/icons-react';
import type { JointActions, MenuRequest } from './joint/useJointPaper';

/** Меню объекта на схеме — то, что открывается правой кнопкой.
 *
 * Раньше эти же действия жили кнопками, нарисованными прямо на полотне над
 * выделенным узлом. Панель занимала место, перекрывала соседей на плотной
 * схеме и жила в координатах схемы — отдалили, и попасть в кнопку было уже
 * нечем, из-за чего её приходилось отдельно масштабировать обратно.
 *
 * Меню рисуется здесь, а не внутри полотна: это обычная разметка, и жить ей
 * полагается рядом с окнами, которые открывают её пункты. Полотно лишь
 * сообщает, по чему щёлкнули и в какой точке экрана.
 *
 * Готовое меню Mantine здесь не подходит: оно привязывается к элементу, из
 * которого его открыли, а открывают отсюда — из точки на полотне, где
 * никакого элемента нет. Поэтому меню выставляется по координатам само, а
 * закрывается прозрачной подложкой во весь экран: щелчок мимо — это отказ.
 */
export function CanvasMenu({
  request, actions, onClose, onStartConnect, canEdit,
}: {
  request: MenuRequest;
  actions: JointActions;
  onClose: () => void;
  /** Протягивание кабеля — жест, а не действие: пункт лишь включает режим,
   * а второй конец выбирается следующим щелчком по схеме. */
  onStartConnect: (deviceId: number) => void;
  canEdit: boolean;
}) {
  const { target, x, y } = request;
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ x, y });

  // Меню, открытое у нижнего или правого края окна, иначе уезжает за экран
  // вместе с половиной пунктов. Размер известен только после отрисовки —
  // поэтому положение поправляется сразу за ней, до показа кадра.
  useLayoutEffect(() => {
    const size = box.current?.getBoundingClientRect();
    if (!size) return;
    const pad = 8;
    setAt({
      x: Math.min(x, window.innerWidth - size.width - pad),
      y: Math.min(y, window.innerHeight - size.height - pad),
    });
  }, [x, y]);

  // По пустому месту меню не нужно: заводить устройство «вот здесь» схема не
  // умеет — новое встаёт в середину видимой области, и для этого есть кнопка
  // над схемой.
  if (!target || !canEdit) return null;

  const run = (action: () => void) => () => { onClose(); action(); };

  return (
    <>
      {/* Подложка во весь экран: щелчок мимо меню закрывает его, и он же не
          доходит до полотна — иначе меню закрывалось бы и одновременно
          снимало выделение.

          Закрывает именно нажатие, а не `contextmenu`: полотно открывает
          меню уже по нажатию правой кнопки (так устроен JointJS), а нативный
          `contextmenu` браузер шлёт только после отпускания — и он приходил
          бы в эту подложку, закрывая меню в тот же миг, как оно появилось.
          Здесь он лишь глушится; правый щелчок мимо меню закроет его
          нажатием, а следующий за ним `contextmenu` уйдёт уже в полотно и
          откроет меню на новом месте. */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 300 }}
        onPointerDown={(event) => { event.stopPropagation(); onClose(); }}
        onContextMenu={(event) => event.preventDefault()}
      />
      <Paper
        ref={box} withBorder shadow="md" radius="sm" py={4}
        style={{ position: 'fixed', left: at.x, top: at.y, zIndex: 301, minWidth: 250 }}
      >
        {target.kind === 'device' ? (
          <>
            <Label>Устройство</Label>
            <Item icon={<IconEdit size={15} />} onClick={run(() => actions.edit(target.id))}>
              Редактировать
            </Item>
            <Item icon={<IconPlug size={15} />} onClick={run(() => onStartConnect(target.id))}>
              Протянуть кабель…
            </Item>
            <Item icon={<IconCopy size={15} />} onClick={run(() => actions.copy(target.id))}>
              Копировать
            </Item>
            <Item icon={<IconUsersGroup size={15} />} onClick={run(() => actions.regroup(target.id))}>
              В группу — или из неё
            </Item>
            <Divider my={4} />
            <Item icon={<IconTrash size={15} />} danger onClick={run(() => actions.remove(target.id))}>
              Удалить
            </Item>
          </>
        ) : (
          <>
            <Label>Группа</Label>
            <Item icon={<IconEdit size={15} />} onClick={run(() => actions.editGroup(target.id))}>
              Название, цвет и состав
            </Item>
            <Item icon={<IconLayoutGrid size={15} />} onClick={run(() => actions.layoutGroup(target.id))}>
              Разложить содержимое
            </Item>
            <Item
              icon={<IconDeviceDesktopPlus size={15} />}
              onClick={run(() => actions.addDeviceToGroup(target.id))}
            >
              Добавить устройство
            </Item>
            <Item icon={<IconFolderPlus size={15} />} onClick={run(() => actions.addSubgroup(target.id))}>
              Добавить подгруппу
            </Item>
            <Divider my={4} />
            <Item icon={<IconTrash size={15} />} danger onClick={run(() => actions.removeGroup(target.id))}>
              Удалить группу — устройства останутся
            </Item>
          </>
        )}
      </Paper>
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <Text size="xs" c="dimmed" px="sm" py={4}>{children}</Text>;
}

function Item({ icon, children, onClick, danger }: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <UnstyledButton
      onClick={onClick}
      px="sm" py={6}
      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}
      c={danger ? 'red' : undefined}
      className="canvas-menu-item"
    >
      {icon}
      <Text size="sm" c={danger ? 'red' : undefined}>{children}</Text>
    </UnstyledButton>
  );
}
