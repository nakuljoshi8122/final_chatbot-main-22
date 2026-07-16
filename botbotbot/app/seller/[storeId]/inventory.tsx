import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SellerTheme, InventoryStatus } from '@/constants/SellerTheme';
import { fetchStoreProducts } from '@/services/storesApi';

const FILTERS: { key: InventoryStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'draft', label: 'Draft' },
  { key: 'archive', label: 'Archive' },
  { key: 'trash', label: 'Trash' },
];

type Row = {
  sku: string;
  name: string;
  category?: string;
  price?: string;
  quantity?: number;
  status?: string;
  img?: string;
};

export default function SellerInventoryScreen() {
  const { storeId } = useLocalSearchParams<{ storeId: string }>();
  const router = useRouter();
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<InventoryStatus | 'all'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchStoreProducts(String(storeId), false);
      setItems(rows as Row[]);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const visible = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((i) => (i.status || 'active') === filter);
  }, [items, filter]);

  return (
    <View style={styles.container}>
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.chip, filter === f.key && styles.chipOn]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.chipText, filter === f.key && styles.chipTextOn]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#fff" />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.sku}
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
          ListEmptyComponent={
            <Text style={styles.empty}>No products in this store yet.</Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() =>
                router.push({
                  pathname: '/inventory/edit',
                  params: { id: item.sku, storeId: String(storeId) },
                })
              }
            >
              {item.img ? (
                <Image source={{ uri: item.img }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, styles.thumbPh]} />
              )}
              <View style={styles.meta}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.sub}>
                  {item.quantity ?? 0} in stock · {item.category} · {item.status || 'active'}
                </Text>
                <Text style={styles.price}>
                  {item.price ? `$${String(item.price).replace(/^\$/, '')}` : '—'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={SellerTheme.textSecondary} />
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SellerTheme.bg },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 12,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: SellerTheme.chipIdle,
  },
  chipOn: { backgroundColor: SellerTheme.chipActive },
  chipText: { color: SellerTheme.text, fontSize: 12, fontWeight: '600' },
  chipTextOn: { color: SellerTheme.chipActiveText },
  empty: { color: SellerTheme.textSecondary, textAlign: 'center', marginTop: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SellerTheme.surface,
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
    gap: 10,
  },
  thumb: { width: 56, height: 56, borderRadius: 8 },
  thumbPh: { backgroundColor: SellerTheme.surfaceElevated },
  meta: { flex: 1 },
  name: { color: SellerTheme.text, fontWeight: '700', fontSize: 15 },
  sub: { color: SellerTheme.textSecondary, fontSize: 12, marginTop: 2 },
  price: { color: SellerTheme.text, fontSize: 13, marginTop: 2 },
});
