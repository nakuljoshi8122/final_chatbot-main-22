/**
 * Legacy "Add" tab — feature kept, entry demoted.
 * Opens Assist with the add-product form (same capability, less chrome).
 */
import React, { useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ThemedText } from '@/shared/ui/ThemedText';
import { SellerTheme } from '@/shared/theme/SellerTheme';

export default function SellerListScreen() {
  const { storeId } = useLocalSearchParams<{ storeId: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/seller/${storeId}?openAdd=1` as never);
  }, [router, storeId]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color={SellerTheme.accent} />
      <ThemedText style={styles.text}>Opening add…</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'transparent',
  },
  text: { color: SellerTheme.text, fontSize: 14, fontWeight: '600' },
});
