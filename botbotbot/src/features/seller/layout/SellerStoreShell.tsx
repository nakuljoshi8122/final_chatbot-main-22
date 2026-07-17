import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Slot, useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/shared/ui/ThemedText';
import { useApp } from '@/contexts/AppContext';

const TABS = [
  { key: '', label: 'Chat', icon: 'chatbubble-ellipses-outline' as const },
  { key: 'list', label: 'List', icon: 'add-circle-outline' as const },
  { key: 'inventory', label: 'Inventory', icon: 'cube-outline' as const },
  { key: 'queries', label: 'Queries', icon: 'help-circle-outline' as const },
];

export default function SellerStoreLayout() {
  const { storeId } = useLocalSearchParams<{ storeId: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const { selectedStore, stores } = useApp();
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
          return (
            <TouchableOpacity key={t.key || 'chat'} style={styles.tab} onPress={() => go(t.key)}>
              <Ionicons name={t.icon} size={18} color={on ? '#1D3557' : '#888'} />
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
  body: { flex: 1 },
});
