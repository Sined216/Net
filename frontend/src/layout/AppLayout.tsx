import { AppShell, Group, NavLink as MantineNavLink, ScrollArea, Text, Button, Stack, Box } from '@mantine/core';
import {
  IconDeviceDesktop, IconTemplate, IconPlugConnected, IconTopologyStar,
  IconSearch, IconTags, IconNetwork, IconUsers, IconLogout,
} from '@tabler/icons-react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const NAV_ITEMS = [
  { to: '/devices', label: 'Устройства', icon: IconDeviceDesktop },
  { to: '/templates', label: 'Шаблоны', icon: IconTemplate },
  { to: '/links', label: 'Связи', icon: IconPlugConnected },
  { to: '/topology', label: 'Топология', icon: IconTopologyStar },
  { to: '/search', label: 'Поиск', icon: IconSearch },
  { to: '/tags', label: 'Теги', icon: IconTags },
  { to: '/vlans', label: 'VLAN', icon: IconNetwork },
];

export function AppLayout() {
  const { user, signOut } = useAuth();

  return (
    <AppShell navbar={{ width: 220, breakpoint: 'sm' }} padding="md">
      <AppShell.Navbar p="sm">
        <Text fw={700} size="lg" px="xs" mb="sm">
          NetDoc
        </Text>
        <ScrollArea style={{ flex: 1 }}>
          <Stack gap={2}>
            {NAV_ITEMS.map((item) => (
              <MantineNavLink
                key={item.to}
                component={NavLink}
                to={item.to}
                label={item.label}
                leftSection={<item.icon size={18} />}
              />
            ))}
            {user?.role === 'admin' && (
              <MantineNavLink component={NavLink} to="/users" label="Пользователи" leftSection={<IconUsers size={18} />} />
            )}
          </Stack>
        </ScrollArea>
        <Box pt="sm" mt="sm" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
          <Text size="sm" c="dimmed" px="xs">
            {user?.full_name} ({user?.role})
          </Text>
          <Button variant="subtle" size="xs" leftSection={<IconLogout size={16} />} onClick={signOut} fullWidth justify="start">
            Выйти
          </Button>
        </Box>
      </AppShell.Navbar>
      <AppShell.Main>
        <Group justify="space-between" mb="md" hiddenFrom="sm" />
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
