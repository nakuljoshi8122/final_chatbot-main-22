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
import { GlassScreen, GlassPane } from '@/shared/ui/Glass';
import { Glass } from '@/shared/theme/LiquidGlass';
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
    <GlassScreen scheme="light">
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <GlassPane
        scheme="light"
        intensity="regular"
        radius={Glass.radius.lg}
        style={styles.headerPane}
        contentStyle={styles.header}
      >
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="arrow-back" size={22} color={Glass.ink.light} />
        </TouchableOpacity>
        <ThemedText style={styles.title}>
          {category === 'Apparel' ? 'Apparels' : category} shops
        </ThemedText>
        <View style={{ width: 22 }} />
      </GlassPane>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={Glass.ink.light} />
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
              <GlassPane
                scheme="light"
                intensity="regular"
                radius={Glass.radius.lg}
                noBlur
                contentStyle={styles.cardContent}
              >
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
              </GlassPane>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  headerPane: {
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { fontSize: 17, fontWeight: '700', color: Glass.ink.light },
  empty: {
    textAlign: 'center',
    color: Glass.ink.lightTertiary,
    marginTop: 40,
    fontStyle: 'italic',
  },
  card: { marginBottom: 12 },
  cardContent: { padding: 16 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  name: { flex: 1, fontSize: 17, fontWeight: '700', color: Glass.ink.light },
  tag: {
    backgroundColor: 'rgba(16,20,37,0.90)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Glass.radius.pill,
  },
  tagText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  owner: { fontSize: 13, color: Glass.ink.lightSecondary, marginBottom: 4 },
  desc: { fontSize: 13, color: Glass.ink.lightTertiary },
});
