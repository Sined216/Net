import { Tabs } from '@mantine/core';
import { useLocation, useNavigate } from 'react-router-dom';

/** Полоса вкладок над всем, что относится к оборудованию.
 *
 * Устройства, их модели и справочники — три страницы одной темы, и работают
 * с ними вперемешку: заводишь железку — оказывается, нет модели; заводишь
 * модель — оказывается, нет разъёма. Раньше каждый такой шаг означал поход в
 * боковое меню и обратно, а меню на тринадцать пунктов ещё надо прочитать.
 *
 * Страницы при этом остались своими маршрутами, а не превратились в
 * содержимое одной: у каждой свои запросы и своё состояние, ссылки вида
 * `/templates` продолжают работать, а вкладка — просто быстрый переход
 * между соседями.
 */

const TABS = [
  { value: '/devices', label: 'Устройства' },
  { value: '/templates', label: 'Шаблоны' },
  { value: '/catalog', label: 'Справочники' },
];

export function EquipmentTabs() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <Tabs
      value={TABS.find((t) => t.value === pathname)?.value ?? null}
      onChange={(value) => value && navigate(value)}
      variant="outline"
    >
      <Tabs.List>
        {TABS.map((tab) => (
          <Tabs.Tab key={tab.value} value={tab.value}>{tab.label}</Tabs.Tab>
        ))}
      </Tabs.List>
    </Tabs>
  );
}
