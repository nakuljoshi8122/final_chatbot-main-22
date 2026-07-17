import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/shared/ui/ThemedText';
import { useApp } from '@/contexts/AppContext';

/** Manual listing entry — opens the product form for this store. */
export default function SellerListScreen() {
  const { storeId } = useLocalSearchParams<{ storeId: string }>();
  const router = useRouter();
  const { selectedStore, stores } = useApp();
  const store =
    selectedStore?.id === storeId
      ? selectedStore
      : stores.find((s) => s.id === storeId);

  return (
    <View style={styles.container}>
      <ThemedText style={styles.title}>List a product</ThemedText>
      <ThemedText style={styles.sub}>
        Add an item manually to {store?.name || 'this store'}. You can also list via Chat with
        photos and follow-up questions.
      </ThemedText>
      <TouchableOpacity
        style={styles.btn}
        onPress={() =>
          router.push({
            pathname: '/inventory/edit',
            params: {
              category: store?.category || 'Handicrafts',
              storeId: String(storeId),
            },
          })
        }
      >
        <Ionicons name="add-circle-outline" size={22} color="#fff" />
        <ThemedText style={styles.btnText}>Open listing form</ThemedText>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#F4F4F2' },
  title: { fontSize: 22, fontWeight: '800', color: '#111', marginBottom: 8 },
  sub: { fontSize: 14, color: '#666', lineHeight: 20, marginBottom: 24 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1D3557',
    borderRadius: 10,
    paddingVertical: 16,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
