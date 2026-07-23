import React, { useCallback, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { Slot, useFocusEffect, useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/shared/ui/ThemedText';
import { useApp } from '@/contexts/AppContext';
import { fetchStoreQueries } from '@/services/storesApi';
import { GlassPane, GlassScreen } from '@/shared/ui/Glass';
import { Glass } from '@/shared/theme/LiquidGlass';

/**
 * Senior-seller IA:
 * Assist = chat-first home · Stock = inventory · Inbox = buyer questions.
 * Add-product lives as a Stock FAB / Assist action — not a fourth equal tab.
 */
const TABS = [
  { key: 'inventory', label: 'Stock', icon: 'cube-outline' as const },
  { key: '', label: 'Assist', icon: 'sparkles-outline' as const },
  { key: 'queries', label: 'Inbox', icon: 'mail-outline' as const },
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
    const base = `/seller/${storeId}` as const;
    router.replace((key ? `${base}/${key}` : base) as Parameters<typeof router.replace>[0]);
  };

  const activeKey = (() => {
    if (pathname.endsWith('/inventory') || pathname.endsWith('/list')) return 'inventory';
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
    <GlassScreen scheme="light">
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <GlassPane scheme="light" intensity="regular" radius={0} flat>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.replace('/seller')} hitSlop={10}>
              <Ionicons name="chevron-back" size={22} color={Glass.ink.light} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <ThemedText style={styles.name} numberOfLines={1}>
                {store?.name || 'Store'}
              </ThemedText>
              {store?.category ? (
                <ThemedText style={styles.category}>{store.category}</ThemedText>
              ) : null}
            </View>
            <View style={{ width: 22 }} />
          </View>

          <View style={styles.tabs}>
            {TABS.map((t) => {
              const on = activeKey === t.key;
              const badge = t.key === 'queries' ? openQueries : 0;
              return (
                <TouchableOpacity
                  key={t.key || 'assist'}
                  style={[styles.tab, on && styles.tabOn]}
                  onPress={() => go(t.key)}
                  activeOpacity={0.75}
                >
                  <View>
                    <Ionicons
                      name={t.icon}
                      size={18}
                      color={on ? Glass.tint.blue : Glass.ink.light}
                    />
                    {badge > 0 ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
                      </View>
                    ) : null}
                  </View>
                  <ThemedText style={[styles.tabLabel, on && styles.tabLabelOn]}>
                    {t.label}
                  </ThemedText>
                </TouchableOpacity>
              );
            })}
          </View>
        </GlassPane>

        <View style={styles.body}>
          <Slot />
        </View>
      </SafeAreaView>
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 10,
  },
  headerCenter: { flex: 1, alignItems: 'center', gap: 1 },
  name: { fontSize: 16, fontWeight: '700', color: Glass.ink.light },
  category: {
    fontSize: 11,
    fontWeight: '600',
    color: Glass.ink.lightSecondary,
    letterSpacing: 0.2,
  },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 3,
    borderRadius: Glass.radius.pill,
    backgroundColor: Glass.fill.lightSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Glass.stroke.lightOuter,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 8,
    borderRadius: Glass.radius.pill,
  },
  tabOn: {
    backgroundColor: Glass.fill.lightStrong,
  },
  tabLabel: { fontSize: 11, color: Glass.ink.light, fontWeight: '600' },
  tabLabelOn: { color: Glass.tint.blue },
  badge: {
    position: 'absolute',
    top: -6,
    right: -10,
    backgroundColor: Glass.tint.red,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  body: { flex: 1, backgroundColor: 'transparent' },
});
