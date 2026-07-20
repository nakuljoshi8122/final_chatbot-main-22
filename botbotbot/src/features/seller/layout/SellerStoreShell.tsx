import React, { useCallback, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { Slot, useFocusEffect, useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/shared/ui/ThemedText';
import { useApp } from '@/contexts/AppContext';
import { fetchStoreQueries } from '@/services/storesApi';

const TABS = [
  { key: '', label: 'Chat', icon: 'chatbubble-ellipses-outline' as const },
  { key: 'list', label: 'Add', icon: 'add-circle-outline' as const },
  { key: 'inventory', label: 'Inventory', icon: 'cube-outline' as const },
  { key: 'queries', label: 'Queries', icon: 'help-circle-outline' as const },
];

export default function SellerStoreLayout() {
  const { storeId } = useLocalSearchParams<{ storeId: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const { selectedStore, stores } = useApp();
  const [openQueries, setOpenQueries] = useState(0);
  const store =
    selectedStore?.id === storeId
      ? selectedStore
      : stores.find((s) => s.id === storeId) || selectedStore;

  const go = (key: string) => {
    const base = `/seller/${storeId}`;
    router.replace(key ? `${base}/${key}` : base);
  };

  const activeKey = (() => {
    if (pathname.endsWith('/list')) return 'list';
    if (pathname.endsWith('/inventory')) return 'inventory';
    if (pathname.endsWith('/queries')) return 'queries';
    return '';
  })();

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const rows = await fetchStoreQueries(String(storeId), 'open');
        if (!cancelled) setOpenQueries(rows.length);
      })();
      return () => {
        cancelled = true;
      };
    }, [storeId]),
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/seller')} hitSlop={10}>
          <Ionicons name="arrow-back" size={22} color="#111" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <ThemedText style={styles.name} numberOfLines={1}>
            {store?.name || 'Store'}
          </ThemedText>
          {store?.category ? (
            <View style={styles.tag}>
              <ThemedText style={styles.tagText}>{store.category}</ThemedText>
            </View>
          ) : null}
        </View>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.tabs}>
        {TABS.map((t) => {
          const on = activeKey === t.key;
          const badge = t.key === 'queries' ? openQueries : 0;
          return (
            <TouchableOpacity key={t.key || 'chat'} style={styles.tab} onPress={() => go(t.key)}>
              <View>
                <Ionicons name={t.icon} size={18} color={on ? '#1D3557' : '#888'} />
                {badge > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
                  </View>
                ) : null}
              </View>
              <ThemedText style={[styles.tabLabel, on && styles.tabLabelOn]}>{t.label}</ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.body}>
        <Slot />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F4F2' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#EAEAEA',
    gap: 10,
  },
  headerCenter: { flex: 1, alignItems: 'center', gap: 4 },
  name: { fontSize: 16, fontWeight: '700', color: '#111' },
  tag: {
    backgroundColor: '#111',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tagText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#EAEAEA',
    paddingVertical: 6,
  },
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 6 },
  tabLabel: { fontSize: 11, color: '#888', fontWeight: '600' },
  tabLabelOn: { color: '#1D3557' },
  badge: {
    position: 'absolute',
    top: -6,
    right: -10,
    backgroundColor: '#B00020',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  body: { flex: 1 },
});
