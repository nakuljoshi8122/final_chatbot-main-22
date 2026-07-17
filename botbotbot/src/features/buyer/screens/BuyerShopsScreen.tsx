import React, { useCallback, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/shared/ui/ThemedText';
import { fetchStores, ShopStore } from '@/services/storesApi';
import { useApp } from '@/contexts/AppContext';

export default function BuyerShopsScreen() {
  const { category } = useLocalSearchParams<{ category: string }>();
  const router = useRouter();
  const { selectStore } = useApp();
  const [shops, setShops] = useState<ShopStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const list = await fetchStores(String(category));
    setShops(list);
    setLoading(false);
  }, [category]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openShop = async (shop: ShopStore) => {
    await selectStore(shop);
    router.push(`/buyer/${category}/${shop.id}`);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="arrow-back" size={22} color="#111" />
        </TouchableOpacity>
        <ThemedText style={styles.title}>
          {category === 'Apparel' ? 'Apparels' : category} shops
        </ThemedText>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#111" />
      ) : (
        <FlatList
          data={shops}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
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
          ListEmptyComponent={
            <ThemedText style={styles.empty}>No shops in this category yet.</ThemedText>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => openShop(item)}>
              <View style={styles.cardTop}>
                <ThemedText style={styles.name}>{item.name}</ThemedText>
                <View style={styles.tag}>
                  <ThemedText style={styles.tagText}>{item.category}</ThemedText>
                </View>
              </View>
              <ThemedText style={styles.owner}>by {item.owner_name}</ThemedText>
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
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E6E6E6',
  },
  title: { fontSize: 17, fontWeight: '700', color: '#111' },
  empty: { textAlign: 'center', color: '#888', marginTop: 40, fontStyle: 'italic' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E6E6E6',
    marginBottom: 12,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  name: { flex: 1, fontSize: 17, fontWeight: '700', color: '#111' },
  tag: {
    backgroundColor: '#111',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  tagText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  owner: { fontSize: 13, color: '#666', marginBottom: 4 },
  desc: { fontSize: 13, color: '#888' },
});
