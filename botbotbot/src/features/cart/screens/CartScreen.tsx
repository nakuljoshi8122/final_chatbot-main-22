import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ThemedText } from '@/shared/ui/ThemedText';
import { Brand } from '@/shared/theme/Brand';
import { GlassScreen, GlassPane } from '@/shared/ui/Glass';
import { Glass } from '@/shared/theme/LiquidGlass';
import { useApp } from '@/contexts/AppContext';
import { useCart } from '@/contexts/CartContext';
import { CartItem } from '@/services/cartApi';

export default function CartScreen() {
  const router = useRouter();
  const { stores } = useApp();
  const { cart, refresh, updateQty, remove, clear, checkout } = useCart();
  const [loading, setLoading] = useState(true);
  const [busySku, setBusySku] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const storeName = (storeId?: string) => {
    if (!storeId) return 'Shop';
    return stores.find((s) => s.id === storeId)?.name || 'Shop';
  };

  const groups = useMemo(() => {
    const map = new Map<string, CartItem[]>();
    for (const it of cart.items) {
      const key = it.store_id || 'other';
      map.set(key, [...(map.get(key) || []), it]);
    }
    return Array.from(map.entries());
  }, [cart.items]);

  const changeQty = async (item: CartItem, next: number) => {
    setBusySku(item.sku);
    const res = await updateQty(item.sku, next);
    setBusySku(null);
    if (!res.ok && res.error === 'sold_out') {
      Alert.alert('Out of stock', 'No more units available for this item.');
    }
  };

  const removeItem = async (item: CartItem) => {
    setBusySku(item.sku);
    await remove(item.sku);
    setBusySku(null);
  };

  const onClear = () => {
    if (!cart.items.length) return;
    Alert.alert('Clear cart', 'Remove all items and release their stock?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => void clear() },
    ]);
  };

  const onCheckout = async () => {
    if (!cart.items.length) return;
    setCheckingOut(true);
    const res = await checkout();
    setCheckingOut(false);
    if (res.ok) {
      Alert.alert('Order placed', 'Thank you! Your order has been confirmed.');
    } else {
      Alert.alert('Checkout failed', res.error || 'Please try again.');
    }
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
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="arrow-back" size={22} color={Glass.ink.light} />
        </Pressable>
        <ThemedText style={styles.headerTitle}>Your Cart</ThemedText>
        <Pressable onPress={onClear} hitSlop={10} disabled={!cart.items.length}>
          <Text style={[styles.clearText, !cart.items.length && styles.disabled]}>Clear</Text>
        </Pressable>
      </GlassPane>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Glass.ink.light} />
        </View>
      ) : !cart.items.length ? (
        <View style={styles.centered}>
          <Ionicons name="cart-outline" size={44} color={Brand.colors.muted} />
          <Text style={styles.emptyText}>Your cart is empty.</Text>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll}>
            {groups.map(([storeId, items]) => (
              <View key={storeId} style={styles.group}>
                <View style={styles.groupHeader}>
                  <Ionicons name="storefront-outline" size={15} color={Glass.ink.lightSecondary} />
                  <Text style={styles.groupTitle}>{storeName(storeId)}</Text>
                </View>
                {items.map((item) => (
                  <GlassPane
                    key={item.sku}
                    scheme="light"
                    intensity="regular"
                    radius={Glass.radius.md}
                    noBlur
                    flat
                    style={styles.lineOuter}
                    contentStyle={styles.line}
                  >
                    {item.img ? (
                      <Image source={{ uri: item.img }} style={styles.thumb} contentFit="cover" />
                    ) : (
                      <View style={[styles.thumb, styles.thumbFallback]}>
                        <Ionicons name="image-outline" size={20} color={Brand.colors.muted} />
                      </View>
                    )}
                    <View style={styles.lineBody}>
                      <Text style={styles.lineName} numberOfLines={2}>{item.name}</Text>
                      <Text style={styles.linePrice}>{item.price}</Text>
                      <View style={styles.stepper}>
                        <Pressable
                          style={styles.stepBtn}
                          onPress={() => changeQty(item, item.qty - 1)}
                          disabled={busySku === item.sku}
                        >
                          <Ionicons name="remove" size={16} color={Glass.ink.light} />
                        </Pressable>
                        <Text style={styles.qty}>{item.qty}</Text>
                        <Pressable
                          style={styles.stepBtn}
                          onPress={() => changeQty(item, item.qty + 1)}
                          disabled={busySku === item.sku || (item.available ?? 0) <= 0}
                        >
                          <Ionicons name="add" size={16} color={Glass.ink.light} />
                        </Pressable>
                      </View>
                    </View>
                    <Pressable
                      onPress={() => removeItem(item)}
                      hitSlop={8}
                      disabled={busySku === item.sku}
                      style={styles.trash}
                    >
                      <Ionicons name="trash-outline" size={18} color={Glass.tint.red} />
                    </Pressable>
                  </GlassPane>
                ))}
              </View>
            ))}
          </ScrollView>

          <GlassPane
            scheme="light"
            intensity="strong"
            radius={Glass.radius.xl}
            style={styles.footerPane}
            contentStyle={styles.footer}
          >
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal ({cart.count})</Text>
              <Text style={styles.totalValue}>${cart.subtotal.toFixed(2)}</Text>
            </View>
            <Pressable
              style={styles.checkoutBtn}
              onPress={onCheckout}
              disabled={checkingOut}
            >
              {checkingOut ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.checkoutText}>Checkout</Text>
              )}
            </Pressable>
          </GlassPane>
        </>
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
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Glass.ink.light },
  clearText: { color: Glass.tint.red, fontWeight: '600', fontSize: 14 },
  disabled: { opacity: 0.35 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyText: { color: Glass.ink.lightSecondary, fontSize: 15 },
  scroll: { padding: 12, paddingBottom: 24 },
  group: { marginBottom: 16 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  groupTitle: { fontSize: 13, fontWeight: '700', color: Glass.ink.lightSecondary },
  lineOuter: { marginBottom: 8 },
  line: {
    flexDirection: 'row',
    padding: 10,
    gap: 12,
    alignItems: 'center',
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: Glass.radius.sm,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  lineBody: { flex: 1, gap: 4 },
  lineName: { fontSize: 14, fontWeight: '700', color: Glass.ink.light },
  linePrice: { fontSize: 13, color: Glass.ink.light, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4 },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Glass.stroke.lightOuter,
    backgroundColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qty: {
    fontSize: 15,
    fontWeight: '700',
    color: Glass.ink.light,
    minWidth: 18,
    textAlign: 'center',
  },
  trash: { padding: 4 },
  footerPane: {
    marginHorizontal: 12,
    marginBottom: 12,
  },
  footer: {
    padding: 16,
    gap: 12,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: 15, color: Glass.ink.lightSecondary, fontWeight: '600' },
  totalValue: { fontSize: 20, fontWeight: '800', color: Glass.ink.light },
  checkoutBtn: {
    height: 50,
    borderRadius: Glass.radius.pill,
    backgroundColor: 'rgba(16,20,37,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkoutText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
