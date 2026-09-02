/**
 * Разделы — постоянной панелью внизу, как пункты меню на сайте.
 *
 * Раньше по приложению ходили большими кнопками посреди экрана («Что
 * найдено», «Открыть спецификацию»). Панель делает то же самое, но всегда
 * на виду и — главное — показывает счётчик несданных находок с любого
 * экрана: ради этого счётчика она и нужна.
 *
 * Настройки связи в панель не вынесены. Их трогают дважды в день, а на
 * сайте их родня («Сменить пароль», «Выйти») тоже не в меню, а в подвале.
 * Они открываются шестерёнкой из шапки «Обмена».
 */

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, ICON, useTheme } from '../ui';
import { useAppState } from '../state';
import { DevicesScreen } from '../screens/DevicesScreen';
import { DeviceScreen } from '../screens/DeviceScreen';
import { AddDeviceScreen } from '../screens/AddDeviceScreen';
import { AddLinkScreen } from '../screens/AddLinkScreen';
import { QueueScreen } from '../screens/QueueScreen';
import { SyncScreen } from '../screens/SyncScreen';
import { ConnectionScreen } from '../screens/ConnectionScreen';
import { ChangePasswordScreen } from '../screens/ChangePasswordScreen';
import type { QueueStackParams, SpecStackParams, SyncStackParams, TabParams } from './types';

const Tabs = createBottomTabNavigator<TabParams>();
const SpecStack = createNativeStackNavigator<SpecStackParams>();
const QueueStack = createNativeStackNavigator<QueueStackParams>();
const SyncStack = createNativeStackNavigator<SyncStackParams>();

/** Общий вид шапки: цвета берутся из темы, тень убрана — на сайте теней нет. */
function useStackOptions() {
  const { p } = useTheme();
  return {
    headerStyle: { backgroundColor: p.surface },
    headerTitleStyle: { color: p.text, fontSize: 18, fontWeight: '700' as const },
    headerTintColor: p.primary,
    headerShadowVisible: false,
    contentStyle: { backgroundColor: p.bg },
  };
}

function SpecTab() {
  const options = useStackOptions();
  return (
    <SpecStack.Navigator screenOptions={options}>
      <SpecStack.Screen name="Devices" component={DevicesScreen} options={{ title: 'Спецификация' }} />
      <SpecStack.Screen name="Device" component={DeviceScreen} options={{ title: 'Устройство' }} />
      <SpecStack.Screen name="AddDevice" component={AddDeviceScreen} options={{ title: 'Новое устройство' }} />
      <SpecStack.Screen name="AddLink" component={AddLinkScreen} options={{ title: 'Новая связь' }} />
    </SpecStack.Navigator>
  );
}

function QueueTab() {
  const options = useStackOptions();
  return (
    <QueueStack.Navigator screenOptions={options}>
      <QueueStack.Screen name="Queue" component={QueueScreen} options={{ title: 'Найдено в цеху' }} />
      <QueueStack.Screen name="AddDevice" component={AddDeviceScreen} options={{ title: 'Новое устройство' }} />
      <QueueStack.Screen name="AddLink" component={AddLinkScreen} options={{ title: 'Новая связь' }} />
    </QueueStack.Navigator>
  );
}

function SyncTab() {
  const options = useStackOptions();
  return (
    <SyncStack.Navigator screenOptions={options}>
      <SyncStack.Screen name="Sync" component={SyncScreen} options={{ title: 'Обмен с WireMap' }} />
      <SyncStack.Screen name="Connection" component={ConnectionScreen} options={{ title: 'Связь с WireMap' }} />
      <SyncStack.Screen
        name="ChangePassword" component={ChangePasswordScreen} options={{ title: 'Смена пароля' }}
      />
    </SyncStack.Navigator>
  );
}

export function RootTabs() {
  const { p } = useTheme();
  const insets = useSafeAreaInsets();
  const { pending } = useAppState();
  const waiting = pending.devices + pending.links;

  return (
    <Tabs.Navigator
      screenOptions={{
        // Шапку рисует стек внутри вкладки — иначе их было бы две.
        headerShown: false,
        tabBarActiveTintColor: p.primary,
        tabBarInactiveTintColor: p.dim,
        tabBarStyle: {
          backgroundColor: p.surface,
          borderTopColor: p.border,
          borderTopWidth: 1,
          height: 60 + insets.bottom,
          paddingTop: 6,
          paddingBottom: 6 + insets.bottom,
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        // Экраны добавления — формы; панель, едущая на клавиатуре, только мешает.
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="SpecTab" component={SpecTab}
        options={{
          title: 'Спецификация',
          tabBarIcon: ({ color }) => <Feather name="server" size={ICON.tab} color={color} />,
        }}
      />
      <Tabs.Screen
        name="QueueTab" component={QueueTab}
        options={{
          title: 'Найдено',
          tabBarIcon: ({ color }) => <Feather name="inbox" size={ICON.tab} color={color} />,
          // Оранжевый, не красный: несданные находки — это «есть что сделать»,
          // а не ошибка. Ту же разницу проводит и сайт.
          tabBarBadge: waiting || undefined,
          tabBarBadgeStyle: {
            backgroundColor: p.orangeText, color: '#ffffff',
            fontSize: 11, minWidth: 18, height: 18, lineHeight: 18,
          },
        }}
      />
      <Tabs.Screen
        name="SyncTab" component={SyncTab}
        options={{
          title: 'Обмен',
          tabBarIcon: ({ color }) => <Feather name="refresh-cw" size={ICON.tab} color={color} />,
        }}
      />
    </Tabs.Navigator>
  );
}
