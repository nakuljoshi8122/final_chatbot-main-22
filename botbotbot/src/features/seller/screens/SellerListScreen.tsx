import React, { useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ThemedText } from '@/shared/ui/ThemedText';

/**
 * Lazy path: the old "List" tab used to dump the seller into a manual form.
 * Now it immediately jumps to Chat with the add-product form open.
 */
export default function SellerListScreen() {
  const { storeId } = useLocalSearchParams<{ storeId: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/seller/${storeId}?openAdd=1` as never);
  }, [router, storeId]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color="#1D3557" />
      <ThemedText style={styles.text}>Opening quick add…</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#F4F4F2',
  },
  text: { color: '#666', fontSize: 14, fontWeight: '600' },
});
