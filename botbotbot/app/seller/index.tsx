import React, { useCallback, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/ThemedText';
import { useApp } from '@/context/AppContext';
import { ShopStore } from '@/services/storesApi';

export default function SellerStoresScreen() {
  const router = useRouter();
  const { setRole, refreshStores, selectStore } = useApp();
  const [stores, setStores] = useState<ShopStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const list = await refreshStores();
    setStores(list);
    setLoading(false);
  }, [refreshStores]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openStore = async (store: ShopStore) => {
    await selectStore(store);
    router.push(`/seller/${store.id}`);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={async () => {
            await setRole(null);
            router.replace('/');
          }}
          hitSlop={10}
        >
          <Ionicons name="arrow-back" size={22} color="#111" />
        </TouchableOpacity>
        <ThemedText style={styles.title}>Your stores</ThemedText>
        <TouchableOpacity onPress={() => router.push('/seller/new')} hitSlop={10}>
          <Ionicons name="add-circle" size={28} color="#1D3557" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#111" />
      ) : (
        <FlatList
          data={stores}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
          ListHeaderComponent={
            <TouchableOpacity
              style={styles.newBtn}
              onPress={() => router.push('/seller/new')}
              activeOpacity={0.85}
            >
              <Ionicons name="add" size={22} color="#fff" />
              <ThemedText style={styles.newBtnText}>New store</ThemedText>
            </TouchableOpacity>
          }
          ListEmptyComponent={
            <ThemedText style={styles.empty}>
              No stores yet. Create one to start listing products.
            </ThemedText>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => openStore(item)}
              activeOpacity={0.85}
            >
              <View style={styles.cardTop}>
                <ThemedText style={styles.cardName}>{item.name}</ThemedText>
                <View style={styles.tag}>
                  <ThemedText style={styles.tagText}>{item.category}</ThemedText>
                </View>
              </View>
              <ThemedText style={styles.owner}>Owner: {item.owner_name}</ThemedText>
              {item.description ? (
                <ThemedText style={styles.desc} numberOfLines={2}>
                  {item.description}
                </ThemedText>
              ) : null}
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F4F2' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E6E6E6',
    backgroundColor: '#fff',
  },
  title: { fontSize: 18, fontWeight: '700', color: '#111' },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1D3557',
    borderRadius: 10,
    paddingVertical: 14,
    marginBottom: 16,
  },
  newBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  empty: { textAlign: 'center', color: '#777', marginTop: 24, fontStyle: 'italic' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E6E6E6',
    marginBottom: 12,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
  },
  cardName: { fontSize: 18, fontWeight: '700', color: '#111', flex: 1 },
  tag: {
    backgroundColor: '#111',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  tagText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  owner: { fontSize: 13, color: '#666', marginBottom: 4 },
  desc: { fontSize: 13, color: '#888' },
});
