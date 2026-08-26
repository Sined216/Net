/**
 * WireMap Обход — приложение для сверки спецификации на месте.
 *
 * Порядок работы, под который всё и сделано:
 * 1. в офисе — забрать снимок площадки;
 * 2. в цеху без сети — смотреть спецификацию и отмечать найденное;
 * 3. в офисе — выгрузить найденное. Записи попадают не в спецификацию, а
 *    на разбор: человек переносит их по одной, глядя на то, что уже
 *    заведено.
 *
 * Приложение сознательно ничего не решает за человека: ни один текст,
 * записанный в цеху, не превращается в запись базы автоматически.
 */

import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppStateProvider } from './state';
import { SyncScreen } from './screens/SyncScreen';
import { DevicesScreen } from './screens/DevicesScreen';
import { DeviceScreen } from './screens/DeviceScreen';
import { AddDeviceScreen } from './screens/AddDeviceScreen';
import { AddLinkScreen } from './screens/AddLinkScreen';
import { QueueScreen } from './screens/QueueScreen';
import { colors } from './ui';

export type RootStackParams = {
  Sync: undefined;
  Devices: undefined;
  Device: { id: number };
  AddDevice: undefined;
  /** Конец A подставляется, когда экран открыт от гнезда в карточке. */
  AddLink: { aDeviceId?: number; aDeviceText?: string; aPortText?: string };
  Queue: undefined;
};

const Stack = createNativeStackNavigator<RootStackParams>();

export function App() {
  return (
    <SafeAreaProvider>
      <AppStateProvider>
        <NavigationContainer>
          <StatusBar style="dark" />
          <Stack.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: colors.card },
              headerTitleStyle: { color: colors.text },
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="Sync" component={SyncScreen} options={{ title: 'WireMap Обход' }} />
            <Stack.Screen name="Devices" component={DevicesScreen} options={{ title: 'Спецификация' }} />
            <Stack.Screen name="Device" component={DeviceScreen} options={{ title: 'Устройство' }} />
            <Stack.Screen name="AddDevice" component={AddDeviceScreen} options={{ title: 'Новое устройство' }} />
            <Stack.Screen name="AddLink" component={AddLinkScreen} options={{ title: 'Новая связь' }} />
            <Stack.Screen name="Queue" component={QueueScreen} options={{ title: 'Найдено в цеху' }} />
          </Stack.Navigator>
        </NavigationContainer>
      </AppStateProvider>
    </SafeAreaProvider>
  );
}
