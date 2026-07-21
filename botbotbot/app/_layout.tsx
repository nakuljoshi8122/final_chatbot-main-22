import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts, Inter_400Regular, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import {
  InstrumentSerif_400Regular,
  InstrumentSerif_400Regular_Italic,
} from '@expo-google-fonts/instrument-serif';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LogBox } from 'react-native';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { AppProvider } from '@/contexts/AppContext';
import { CartProvider } from '@/contexts/CartContext';
import { StoreProvider } from '@/features/legacy-store/context/StoreContext';

// Metro HMR can fail mid-reload when the bundler restarts; don't spam a bottom toast.
LogBox.ignoreLogs([
  'LoadBundleFromServerRequestError',
  'LoadBundleFromServerRequestError:',
  /LoadBundleFromServerRequestError/,
  /Could not load bundle/,
]);

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [loaded] = useFonts({
    Inter_400Regular,
    Inter_600SemiBold,
    Inter_700Bold,
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
  });

  if (!loaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppProvider>
          <CartProvider>
            <StoreProvider>
              <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
                <Stack>
                  <Stack.Screen name="index" options={{ headerShown: false }} />
                  <Stack.Screen name="seller" options={{ headerShown: false }} />
                  <Stack.Screen name="buyer" options={{ headerShown: false }} />
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  <Stack.Screen name="product/[id]" options={{ headerShown: false }} />
                  <Stack.Screen name="shelf/[storeId]" options={{ headerShown: false }} />
                  <Stack.Screen name="cart/index" options={{ headerShown: false }} />
                  <Stack.Screen name="inventory/index" options={{ headerShown: false }} />
                  <Stack.Screen
                    name="inventory/edit"
                    options={{ headerShown: false, presentation: 'modal' }}
                  />
                  <Stack.Screen name="+not-found" />
                </Stack>
                <StatusBar style="dark" />
              </ThemeProvider>
            </StoreProvider>
          </CartProvider>
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
