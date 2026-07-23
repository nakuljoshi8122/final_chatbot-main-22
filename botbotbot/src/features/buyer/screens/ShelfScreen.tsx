import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ThemedText } from '@/shared/ui/ThemedText';
import { Brand } from '@/shared/theme/Brand';
import { GlassScreen, GlassPane } from '@/shared/ui/Glass';
import { Glass } from '@/shared/theme/LiquidGlass';
import { useApp } from '@/contexts/AppContext';
import { useCart } from '@/contexts/CartContext';
import { fetchStoreProducts, ApiSellerProduct } from '@/services/storesApi';
import BuyerTileDetailModal, { ShelfProduct } from '@/features/buyer/components/BuyerTileDetailModal';
import { getProductDiscount, withDollar } from '@/shared/utils/productDiscount';

export default function ShelfScreen() {
  const { storeId } = useLocalSearchParams<{ storeId: string }>();
  const router = useRouter();
  const { selectedStore, stores } = useApp();
  const { count } = useCart();
  const store =
    selectedStore?.id === storeId
      ? selectedStore
      : stores.find((s) => s.id === storeId) || null;

  const [products, setProducts] = useState<ApiSellerProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<ShelfProduct | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    if (!storeId) return;
    const list = await fetchStoreProducts(String(storeId), true);
    setProducts(list);
    setLoading(false);
    setRefreshing(false);
  }, [storeId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openTile = (p: ApiSellerProduct) => {
    setSelected({
      sku: p.sku,
      name: p.name,
      price: p.price,
      list_price: p.list_price,
      img: p.img,
      images: p.images,
      url: p.url,
      category: p.category,
      description: p.description,
      quantity: p.quantity ?? 0,
      status: p.status,
      store_id: p.store_id || String(storeId),
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    // Refresh so stock/sold-out reflects any purchase made in the modal.
    void load();
  };

  const renderItem = ({ item }: { item: ApiSellerProduct }) => {
    const soldOut = (item.quantity ?? 0) <= 0;
    const discount = getProductDiscount(item.price, item.list_price);
    return (
      <Pressable style={styles.tile} onPress={() => openTile(item)}>
        <GlassPane
          scheme="light"
          intensity="regular"
          radius={Glass.radius.md}
          noBlur
          flat
        >
        <View style={styles.imageWrap}>
          {item.img ? (
            <Image source={{ uri: item.img }} style={styles.image} contentFit="cover" transition={120} />
          ) : (
            <View style={[styles.image, styles.imageFallback]}>
              <Ionicons name="image-outline" size={26} color={Brand.colors.muted} />
            </View>
          )}
          {soldOut ? (
            <View style={styles.soldOverlay}>
              <Text style={styles.soldText}>SOLD OUT</Text>
            </View>
          ) : null}
          {discount ? (
            <View style={styles.discountBadge}>
              <Text style={styles.discountBadgeText}>{discount.percentOff}% OFF</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.tileBody}>
          <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
          {discount ? (
            <View style={styles.priceRow}>
              <Text style={styles.originalPrice}>{withDollar(item.list_price)}</Text>
              <Text style={styles.salePrice}>{withDollar(item.price)}</Text>
            </View>
          ) : item.price ? (
            <Text style={styles.price}>{withDollar(item.price)}</Text>
          ) : null}
          {!soldOut && (item.quantity ?? 0) <= 3 ? (
            <Text style={styles.lowStock}>Only {item.quantity} left</Text>
          ) : null}
        </View>
        </GlassPane>
      </Pressable>
    );
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
        <View style={styles.headerCenter}>
          <ThemedText style={styles.headerTitle} numberOfLines={1}>
            {store?.name || 'Shelf'}
          </ThemedText>
          <ThemedText style={styles.headerSub}>Shelf</ThemedText>
        </View>
        <Pressable onPress={() => router.push('/cart')} hitSlop={10} style={styles.cartBtn}>
          <Ionicons name="cart-outline" size={22} color={Glass.ink.light} />
          {count > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{count}</Text>
            </View>
          ) : null}
        </Pressable>
      </GlassPane>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Glass.ink.light} />
        </View>
      ) : products.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="cube-outline" size={40} color={Brand.colors.muted} />
          <Text style={styles.emptyText}>No items on the shelf yet.</Text>
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(p) => p.sku}
          renderItem={renderItem}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
            />
          }
        />
      )}

      <BuyerTileDetailModal product={selected} visible={modalOpen} onClose={closeModal} />
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
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: Glass.ink.light },
  headerSub: { fontSize: 11, color: Glass.ink.lightSecondary, marginTop: 2 },
  cartBtn: { padding: 2 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    backgroundColor: Glass.tint.red,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyText: { color: Brand.colors.muted, fontSize: 14 },
  grid: { padding: 10, paddingBottom: 24 },
  row: { gap: 10 },
  tile: {
    flex: 1,
    marginBottom: 10,
  },
  imageWrap: { width: '100%', aspectRatio: 1, backgroundColor: 'rgba(255,255,255,0.45)' },
  image: { width: '100%', height: '100%' },
  imageFallback: { alignItems: 'center', justifyContent: 'center' },
  soldOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20,24,40,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  soldText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 1.5,
    borderWidth: 2,
    borderColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Glass.radius.xs,
  },
  discountBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: Glass.tint.red,
    borderRadius: Glass.radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  discountBadgeText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  tileBody: { padding: 10, gap: 3 },
  name: { fontSize: 13, fontWeight: '700', color: Glass.ink.light, lineHeight: 16 },
  price: { fontSize: 13, fontWeight: '700', color: Glass.ink.light },
  priceRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
  originalPrice: {
    fontSize: 12,
    fontWeight: '700',
    color: Glass.tint.red,
    textDecorationLine: 'line-through',
  },
  salePrice: { fontSize: 13, fontWeight: '900', color: Glass.tint.blue },
  lowStock: { fontSize: 11, color: Glass.tint.red, fontWeight: '600' },
});
