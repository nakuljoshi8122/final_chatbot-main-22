import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Brand } from '@/shared/theme/Brand';
import { Glass } from '@/shared/theme/LiquidGlass';
import { useCart } from '@/contexts/CartContext';
import { notifySubscribeApi } from '@/services/cartApi';
import ProductImageGallery from '@/shared/ui/ProductImageGallery';
import { fetchSellerProduct } from '@/services/storesApi';
import { getProductDiscount, withDollar } from '@/shared/utils/productDiscount';

export type ShelfProduct = {
  sku: string;
  name: string;
  price?: string;
  list_price?: string;
  img?: string;
  images?: string[];
  url?: string;
  category?: string;
  description?: string;
  quantity?: number;
  status?: string;
  store_id?: string;
};

interface Props {
  product: ShelfProduct | null;
  visible: boolean;
  onClose: () => void;
}

export default function BuyerTileDetailModal({ product, visible, onClose }: Props) {
  const router = useRouter();
  const { add, buyNow, refresh } = useCart();
  const [busy, setBusy] = useState<null | 'buy' | 'cart' | 'notify'>(null);
  const [fresh, setFresh] = useState<ShelfProduct | null>(null);

  useEffect(() => {
    if (!visible || !product?.sku) {
      setFresh(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const remote = await fetchSellerProduct(product.sku, product.store_id);
      if (cancelled || !remote) return;
      const images = Array.isArray(remote.images)
        ? remote.images.map(String).filter(Boolean)
        : [];
      if (remote.img && !images.includes(remote.img)) images.unshift(remote.img);
      setFresh({
        sku: remote.sku,
        name: remote.name || product.name,
        price: remote.price || product.price,
        list_price: remote.list_price,
        img: remote.img || product.img,
        images: images.length ? images : product.images,
        url: remote.url || product.url,
        category: remote.category || product.category,
        description: remote.description || product.description,
        quantity:
          typeof remote.quantity === 'number' ? remote.quantity : product.quantity,
        status: remote.status || product.status,
        store_id: remote.store_id || product.store_id,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, product?.sku, product?.store_id]);

  if (!product) return null;

  const p = fresh || product;
  const soldOut = (p.quantity ?? 0) <= 0;
  const discount = getProductDiscount(p.price, p.list_price);
  const gallery = (() => {
    const list = (p.images || []).map(String).filter(Boolean);
    if (p.img && !list.includes(p.img)) list.unshift(p.img);
    return list;
  })();

  const handleAddToCart = async () => {
    setBusy('cart');
    const res = await add(p.sku, p.store_id, 1);
    setBusy(null);
    if (res.ok) {
      Alert.alert('Added to cart', `${p.name} was added to your cart.`);
      onClose();
    } else if (res.error === 'sold_out') {
      Alert.alert('Sold out', 'This item just went out of stock.');
    } else {
      Alert.alert('Something went wrong', 'Could not add to cart. Please try again.');
    }
  };

  const handleBuyNow = async () => {
    setBusy('buy');
    const res = await buyNow(p.sku, p.store_id, 1);
    setBusy(null);
    if (res.ok) {
      await refresh();
      Alert.alert('Order placed', `Your order for ${p.name} is confirmed.`);
      onClose();
    } else if (res.error === 'sold_out') {
      Alert.alert('Sold out', 'This item just went out of stock.');
    } else {
      Alert.alert('Something went wrong', 'Could not place the order. Please try again.');
    }
  };

  const handleNotify = async () => {
    setBusy('notify');
    await notifySubscribeApi(p.sku, p.store_id);
    setBusy(null);
    Alert.alert('Got it!', 'You will be notified when this item is available again.');
    onClose();
  };

  const handleView = () => {
    onClose();
    router.push({
      pathname: '/product/[id]',
      params: {
        id: p.sku,
        name: p.name,
        price: p.price || '',
        category: p.category || '',
        description: p.description || '',
        features: JSON.stringify([]),
        icon: 'pricetag',
      },
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <BlurView
            intensity={Glass.blur.strong}
            tint="light"
            style={StyleSheet.absoluteFill}
          />
          <View pointerEvents="none" style={styles.cardFill} />
          <Pressable style={styles.close} onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={22} color={Glass.ink.light} />
          </Pressable>

          <View style={styles.imageWrap}>
            <ProductImageGallery images={gallery} height={220} borderRadius={14} />
            {soldOut ? (
              <View style={styles.soldOutBadge}>
                <Text style={styles.soldOutBadgeText}>SOLD OUT</Text>
              </View>
            ) : null}
            {discount ? (
              <View style={styles.discountBadge}>
                <Text style={styles.discountBadgeText}>{discount.percentOff}% OFF</Text>
              </View>
            ) : null}
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
            bounces={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.body}>
              <Text style={styles.name}>{p.name}</Text>
              {discount ? (
                <View style={styles.priceRow}>
                  <Text style={styles.originalPrice}>{withDollar(p.list_price)}</Text>
                  <Text style={styles.salePrice}>{withDollar(p.price)}</Text>
                </View>
              ) : p.price ? (
                <Text style={styles.price}>{withDollar(p.price)}</Text>
              ) : null}

              <View style={styles.metaRow}>
                {p.category ? (
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>{p.category}</Text>
                  </View>
                ) : null}
                {!soldOut && typeof p.quantity === 'number' ? (
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>{p.quantity} in stock</Text>
                  </View>
                ) : null}
              </View>

              {p.description ? <Text style={styles.desc}>{p.description}</Text> : null}

              {soldOut ? (
                <Pressable
                  style={[styles.btn, styles.notifyBtn]}
                  onPress={handleNotify}
                  disabled={busy !== null}
                >
                  {busy === 'notify' ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="notifications-outline" size={18} color="#fff" />
                      <Text style={styles.btnTextLight}>Notify me</Text>
                    </>
                  )}
                </Pressable>
              ) : (
                <>
                  <Pressable
                    style={[styles.btn, styles.buyBtn]}
                    onPress={handleBuyNow}
                    disabled={busy !== null}
                  >
                    {busy === 'buy' ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="flash-outline" size={18} color="#fff" />
                        <Text style={styles.btnTextLight}>Buy Now</Text>
                      </>
                    )}
                  </Pressable>
                  <Pressable
                    style={[styles.btn, styles.cartBtn]}
                    onPress={handleAddToCart}
                    disabled={busy !== null}
                  >
                    {busy === 'cart' ? (
                      <ActivityIndicator color="#111" />
                    ) : (
                      <>
                        <Ionicons name="cart-outline" size={18} color="#111" />
                        <Text style={styles.btnTextDark}>Add to Cart</Text>
                      </>
                    )}
                  </Pressable>
                </>
              )}

              <Pressable style={styles.viewLink} onPress={handleView}>
                <Ionicons name="open-outline" size={16} color={Brand.colors.brandBlue} />
                <Text style={styles.viewLinkText}>View full item page</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,24,40,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    maxHeight: '85%',
    backgroundColor: 'transparent',
    borderRadius: Glass.radius.xl,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Glass.stroke.light,
    overflow: 'hidden',
  },
  cardFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Glass.fill.lightStrong,
  },
  close: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 5,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Glass.stroke.lightOuter,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageWrap: {
    width: '100%',
    position: 'relative',
  },
  soldOutBadge: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    backgroundColor: Glass.tint.red,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Glass.radius.pill,
  },
  soldOutBadgeText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  discountBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: Glass.tint.red,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Glass.radius.pill,
  },
  discountBadgeText: { color: '#fff', fontWeight: '900', fontSize: 11 },
  body: { padding: 16, gap: 10, paddingBottom: 22 },
  name: { fontSize: 20, fontWeight: '800', color: Glass.ink.light },
  price: { fontSize: 18, fontWeight: '800', color: Glass.tint.blue },
  priceRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  originalPrice: {
    fontSize: 17,
    fontWeight: '700',
    color: Glass.tint.red,
    textDecorationLine: 'line-through',
  },
  salePrice: { fontSize: 20, fontWeight: '900', color: Glass.tint.blue },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: 'rgba(255,255,255,0.62)',
    borderWidth: 1,
    borderColor: Glass.stroke.lightOuter,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Glass.radius.pill,
  },
  chipText: { fontSize: 12, fontWeight: '600', color: Glass.ink.lightSecondary },
  desc: { fontSize: 14, lineHeight: 20, color: Glass.ink.lightSecondary },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: Glass.radius.pill,
    paddingVertical: 13,
  },
  buyBtn: { backgroundColor: 'rgba(16,20,37,0.92)' },
  cartBtn: {
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: Glass.stroke.lightOuter,
  },
  notifyBtn: { backgroundColor: 'rgba(16,20,37,0.92)' },
  btnTextLight: { color: '#fff', fontWeight: '800', fontSize: 15 },
  btnTextDark: { color: Glass.ink.light, fontWeight: '800', fontSize: 15 },
  viewLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  viewLinkText: {
    color: Brand.colors.brandBlue,
    fontWeight: '700',
    fontSize: 13,
  },
});
