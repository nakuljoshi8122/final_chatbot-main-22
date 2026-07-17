import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/shared/ui/ThemedText';
import { Brand } from '@/shared/theme/Brand';
import { useScreenInsets } from '@/shared/hooks/useScreenInsets';
import { useStore } from '@/features/legacy-store/context/StoreContext';
import { InventoryItem, loadInventory } from '@/services/inventoryStore';

export default function ExploreScreen() {
  const router = useRouter();
  const { store, ready } = useStore();
  const { contentBottomPadding } = useScreenInsets();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (ready && !store) {
      router.replace('/');
    }
  }, [ready, store, router]);

  const load = useCallback(async () => {
    if (!store) return;
    setLoading(true);
    try {
      const all = await loadInventory();
      setItems(
        all.filter(
          (i) => i.status === 'active' && i.category === store.category,
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [store]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ready || !store) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#111" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <ThemedText type="title" style={styles.headerTitle}>
          Shop {store.label}
        </ThemedText>
        <ThemedText style={styles.headerSubtitle}>{store.tagline}</ThemedText>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: contentBottomPadding }}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={store.accent} />
        ) : items.length === 0 ? (
          <ThemedText style={styles.empty}>
            No active {store.label.toLowerCase()} products yet.
          </ThemedText>
        ) : (
          items.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.card}
              activeOpacity={0.85}
              onPress={() =>
                router.push({ pathname: '/product/[id]', params: { id: item.sku } })
              }
            >
              {item.imageUri ? (
                <Image source={{ uri: item.imageUri }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder]} />
              )}
              <View style={styles.cardBody}>
                <ThemedText style={styles.cardTitle} numberOfLines={2}>
                  {item.name}
                </ThemedText>
                <ThemedText style={styles.cardMeta}>
                  {item.price ? `$${String(item.price).replace(/^\$/, '')}` : 'Price TBA'} ·{' '}
                  {item.category}
                </ThemedText>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: Brand.colors.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Brand.colors.border,
    backgroundColor: Brand.colors.accent,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 4,
    color: Brand.colors.primary,
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 14,
    color: Brand.colors.muted,
  },
  empty: {
    color: Brand.colors.muted,
    fontStyle: 'italic',
    marginTop: 24,
    textAlign: 'center',
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: Brand.colors.border,
    borderRadius: 8,
    marginBottom: 12,
    overflow: 'hidden',
  },
  thumb: {
    width: 88,
    height: 88,
    backgroundColor: '#eee',
  },
  thumbPlaceholder: {
    backgroundColor: '#ddd',
  },
  cardBody: {
    flex: 1,
    padding: 12,
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Brand.colors.primary,
    marginBottom: 4,
  },
  cardMeta: {
    fontSize: 13,
    color: Brand.colors.muted,
  },
});
