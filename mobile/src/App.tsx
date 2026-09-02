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
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppStateProvider, useAppState } from './state';
import { RootTabs } from './navigation/RootTabs';
import { ThemeProvider, navigationTheme, useTheme } from './ui';

/**
 * Пока база не прочитана, экранов нет.
 *
 * Дело не в мигании: поля на экранах берут начальные значения из настроек, а
 * начальное значение состояния берётся один раз, при первом рендере. Пусти
 * мы экраны раньше — адрес сервера остался бы пустым при сохранённом, ровно
 * как было до появления настроек. Ожидание — одно открытие SQLite.
 */
function Gate() {
  const { ready } = useAppState();
  const theme = useTheme();

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.p.bg }}>
        <ActivityIndicator size="large" color={theme.p.primary} />
      </View>
    );
  }
  return (
    <NavigationContainer theme={navigationTheme(theme)}>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <RootTabs />
    </NavigationContainer>
  );
}

export function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppStateProvider>
          <Gate />
        </AppStateProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
