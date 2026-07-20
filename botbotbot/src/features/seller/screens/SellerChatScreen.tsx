import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import SellerChatInterface from '@/features/seller/components/SellerChatInterface';
import { useApp } from '@/contexts/AppContext';

export default function SellerChatScreen() {
  const { storeId, openAdd } = useLocalSearchParams<{ storeId: string; openAdd?: string }>();
  const { selectedStore, stores } = useApp();
  const store =
    selectedStore?.id === storeId
      ? selectedStore
      : stores.find((s) => s.id === storeId) || null;

  return (
    <View style={styles.container}>
      <SellerChatInterface
        storeId={String(storeId)}
        storeName={store?.name || 'Store'}
        category={String(store?.category || 'Handicrafts')}
        autoOpenAdd={openAdd === '1'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
});
