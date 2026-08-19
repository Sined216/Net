import { useEffect, useState } from 'react';
import {
  AppShell, Burger, Group, NavLink as MantineNavLink, ScrollArea, Select, Text, Button, Stack, Box,
} from '@mantine/core';
import {
  IconDeviceDesktop, IconPlugConnected, IconTopologyStar,
  IconSearch, IconTags, IconNetwork, IconUsers, IconLogout, IconKey, IconDatabase,
  IconFileImport, IconBuildingFactory2, IconHistory,
} from '@tabler/icons-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ChangePasswordModal } from '../auth/ChangePasswordModal';
import { useSite } from '../sites/SiteContext';

/** Меню разделами, а не одним списком из тринадцати пунктов.
 *
 * «Оборудование» — один пункт на три страницы (устройства, их модели,
 * справочники): работают с ними вперемешку, и раньше каждый шаг «а модели-то
 * нет» означал поход в меню и обратно. Переключаются они теперь вкладками
 * наверху самой страницы, а меню про них знает одно: они про железо.
 *
 * `match` нужен затем же: пункт должен подсвечиваться, когда открыта любая
 * из его страниц, а не только та, на которую он ведёт.
 */
const NAV_SECTIONS: {
  title: string;
  items: { to: string; label: string; icon: typeof IconDeviceDesktop; match?: string[]; admin?: boolean }[];
}[] = [
  {
    title: 'Сеть',
    items: [
      {
        to: '/devices', label: 'Оборудование', icon: IconDeviceDesktop,
        match: ['/devices', '/templates', '/catalog'],
      },
      { to: '/links', label: 'Связи', icon: IconPlugConnected },
      { to: '/topology', label: 'Топология', icon: IconTopologyStar },
    ],
  },
  {
    title: 'Классификация',
    items: [
      { to: '/tags', label: 'Теги', icon: IconTags },
      { to: '/vlans', label: 'VLAN', icon: IconNetwork },
    ],
  },
  {
    title: 'Работа',
    items: [
      { to: '/import', label: 'Импорт', icon: IconFileImport },
      { to: '/search', label: 'Поиск', icon: IconSearch },
      { to: '/history', label: 'История', icon: IconHistory },
    ],
  },
  {
    // Структура БД доступна всем ролям, как и на сервере: это не управление,
    // а взгляд внутрь. Площадки и учётные записи — только администратору.
    title: 'Система',
    items: [
      { to: '/schema', label: 'Структура БД', icon: IconDatabase },
      { to: '/sites', label: 'Площадки', icon: IconBuildingFactory2, admin: true },
      { to: '/users', label: 'Пользователи', icon: IconUsers, admin: true },
    ],
  },
];

/** Заголовок вкладки браузера по разделу — раньше везде было голое
 * «WireMap», и несколько открытых вкладок было не различить (находка 8
 * проверки удобства). Порядок важен: «/devices/» проверяется раньше
 * «/devices», иначе карточка устройства получала бы заголовок списка.
 * Для самой карточки это только запасной вариант — код устройства в
 * заголовке ставит DevicePage, как только он известен. */
const PAGE_TITLES: { test: (path: string) => boolean; title: string }[] = [
  { test: (p) => p.startsWith('/devices/'), title: 'Устройство' },
  { test: (p) => p === '/devices', title: 'Оборудование' },
  { test: (p) => p === '/templates', title: 'Шаблоны' },
  { test: (p) => p === '/catalog', title: 'Справочники' },
  { test: (p) => p === '/links', title: 'Связи' },
  { test: (p) => p === '/topology', title: 'Топология' },
  { test: (p) => p === '/search', title: 'Поиск' },
  { test: (p) => p === '/tags', title: 'Теги' },
  { test: (p) => p === '/vlans', title: 'VLAN' },
  { test: (p) => p === '/import', title: 'Импорт' },
  { test: (p) => p === '/history', title: 'История' },
  { test: (p) => p === '/schema', title: 'Структура БД' },
  { test: (p) => p === '/sites', title: 'Площадки' },
  { test: (p) => p === '/users', title: 'Пользователи' },
];

export function AppLayout() {
  const { user, signOut } = useAuth();
  const { sites, siteId, selectSite } = useSite();
  const { pathname } = useLocation();
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  // На узком экране навбар — не боковая колонка, а страница поверх
  // страницы: без `collapsed` он всегда открыт и без бургера его нечем
  // убрать, чтобы добраться до содержимого. Закрывается сам при переходе —
  // иначе выбор пункта меню оставлял бы его висеть поверх открывшейся
  // страницы.
  const [navOpened, setNavOpened] = useState(false);
  useEffect(() => setNavOpened(false), [pathname]);

  useEffect(() => {
    const page = PAGE_TITLES.find(({ test }) => test(pathname));
    document.title = page ? `${page.title} — WireMap` : 'WireMap';
  }, [pathname]);

  // Пароль назначен не владельцем — до смены работать нельзя. Модалка без
  // крестика, мимо неё не пройти.
  const mustChangePassword = user?.must_change_password ?? false;

  return (
    <AppShell
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !navOpened } }}
      padding="md"
    >
      <AppShell.Navbar p="sm">
        <Text fw={700} size="lg" px="xs" mb={6}>
          WireMap
        </Text>
        {/* Площадка — контекст всего, что видно ниже, поэтому стоит над
            меню, а не теряется в настройках. Одна площадка — выбирать не из
            чего, и переключатель только занимал бы место. */}
        {sites.length > 1 && (
          <Select
            size="xs" mb="sm" allowDeselect={false} comboboxProps={{ withinPortal: true }}
            leftSection={<IconBuildingFactory2 size={14} />}
            data={sites.map((s) => ({ value: String(s.id), label: s.name }))}
            value={siteId != null ? String(siteId) : null}
            onChange={(value) => value && selectSite(parseInt(value, 10))}
          />
        )}
        <ScrollArea style={{ flex: 1 }}>
          <Stack gap={2}>
            {NAV_SECTIONS.map((section) => {
              const items = section.items.filter((item) => !item.admin || user?.role === 'admin');
              if (items.length === 0) return null;
              return (
                <div key={section.title}>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600} px="xs" mt="sm" mb={4}>
                    {section.title}
                  </Text>
                  {items.map((item) => (
                    <MantineNavLink
                      key={item.to}
                      component={NavLink}
                      to={item.to}
                      label={item.label}
                      leftSection={<item.icon size={18} />}
                      // Пункт горит и когда открыта соседняя страница того же
                      // раздела: иначе «Оборудование» гаснет, стоит перейти
                      // на вкладку шаблонов, и меню выглядит сбитым.
                      active={item.match?.some((path) => pathname.startsWith(path)) || undefined}
                    />
                  ))}
                </div>
              );
            })}
          </Stack>
        </ScrollArea>
        <Box pt="sm" mt="sm" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
          <Text size="sm" c="dimmed" px="xs">
            {user?.full_name} ({user?.role})
          </Text>
          <Button
            variant="subtle" size="xs" leftSection={<IconKey size={16} />}
            onClick={() => setPasswordModalOpen(true)} fullWidth justify="start"
          >
            Сменить пароль
          </Button>
          <Button variant="subtle" size="xs" leftSection={<IconLogout size={16} />} onClick={signOut} fullWidth justify="start">
            Выйти
          </Button>
        </Box>
      </AppShell.Navbar>
      <AppShell.Main>
        <Group justify="space-between" mb="md" hiddenFrom="sm">
          <Text fw={700} size="lg">WireMap</Text>
          <Burger opened={navOpened} onClick={() => setNavOpened((o) => !o)} size="sm" aria-label="Меню" />
        </Group>
        <Outlet />
      </AppShell.Main>
      {(passwordModalOpen || mustChangePassword) && (
        <ChangePasswordModal forced={mustChangePassword} onClose={() => setPasswordModalOpen(false)} />
      )}
    </AppShell>
  );
}
