import { useEffect } from 'react';
import { Appearance } from 'react-native';
import { Stack } from 'expo-router';

/**
 * Seller UI is light-theme only (frosted panes + dark ink).
 * Force the RN color scheme while this stack is mounted so ThemedText /
 * navigation chrome don't flip to pale dark-mode text.
 */
export default function SellerLayout() {
  useEffect(() => {
    Appearance.setColorScheme('light');
    return () => {
      Appearance.setColorScheme(null);
    };
  }, []);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="[storeId]" />
    </Stack>
  );
}
