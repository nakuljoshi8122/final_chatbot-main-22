import React, { useState } from 'react';
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
import { Brand } from '@/shared/theme/Brand';
import { useCart } from '@/contexts/CartContext';
import { notifySubscribeApi } from '@/services/cartApi';
import ProductImageGallery from '@/shared/ui/ProductImageGallery';

export type ShelfProduct = {
  sku: string;
  name: string;
  price?: string;
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

  if (!product) return null;

  const soldOut = (product.quantity ?? 0) <= 0;
  const gallery = (() => {
    const list = (product.images || []).map(String).filter(Boolean);
    if (product.img && !list.includes(product.img)) list.unshift(product.img);
    return list;
  })();

  const handleAddToCart = async () => {
    setBusy('cart');
    const res = await add(product.sku, product.store_id, 1);
    setBusy(null);
    if (res.ok) {
      Alert.alert('Added to cart', `${product.name} was added to your cart.`);
      onClose();
    } else if (res.error === 'sold_out') {
      Alert.alert('Sold out', 'This item just went out of stock.');
    } else {
      Alert.alert('Something went wrong', 'Could not add to cart. Please try again.');
    }
  };

  const handleBuyNow = async () => {
    setBusy('buy');
    const res = await buyNow(product.sku, product.store_id, 1);
    setBusy(null);
    if (res.ok) {
      await refresh();
      Alert.alert('Order placed', `Your order for ${product.name} is confirmed.`);
      onClose();
    } else if (res.error === 'sold_out') {
      Alert.alert('Sold out', 'This item just went out of stock.');
    } else {
      Alert.alert('Something went wrong', 'Could not place the order. Please try again.');
    }
  };

  const handleNotify = async () => {
    setBusy('notify');
    await notifySubscribeApi(product.sku, product.store_id);
    setBusy(null);
    Alert.alert('Got it!', 'You will be notified when this item is available again.');
    onClose();
  };

  const handleView = () => {
    onClose();
    router.push({
      pathname: '/product/[id]',
      params: {
        id: product.sku,
        name: product.name,
        price: product.price || '',
        category: product.category || '',
        description: product.description || '',
        features: JSON.stringify([]),
        icon: 'pricetag',
      },
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Pressable style={styles.close} onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={22} color="#111" />
          </Pressable>

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.imageWrap}>
              <ProductImageGallery images={gallery} height={220} borderRadius={14} />
              {soldOut ? (
                <View style={styles.soldOutBadge}>
                  <Text style={styles.soldOutBadgeText}>SOLD OUT</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.body}>
              <Text style={styles.name}>{product.name}</Text>
              {product.price ? <Text style={styles.price}>{product.price}</Text> : null}

              <View style={styles.metaRow}>
                {product.category ? (
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>{product.category}</Text>
                  </View>
                ) : null}
                {!soldOut ? (
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>{product.quantity} in stock</Text>
                  </View>
                ) : null}
              </View>

              {product.description ? (
                <Text style={styles.desc}>{product.description}</Text>
              ) : null}

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
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    maxHeight: '85%',
    backgroundColor: '#fff',
    borderRadius: 18,
    overflow: 'hidden',
  },
  close: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 10,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 16,
    padding: 4,
  },
  imageWrap: { width: '100%', height: 240, backgroundColor: Brand.colors.background },
  image: { width: '100%', height: 240 },
  imageFallback: { alignItems: 'center', justifyContent: 'center' },
  soldOutBadge: {
    position: 'absolute',
    top: 14,
    left: 14,
    backgroundColor: '#B00020',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  soldOutBadgeText: { color: '#fff', fontWeight: '800', fontSize: 12, letterSpacing: 1 },
  body: { padding: 18, gap: 10 },
  name: { fontSize: 20, fontWeight: '800', color: '#111' },
  price: { fontSize: 18, fontWeight: '700', color: '#111' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: '#F1F1F1',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: { fontSize: 12, color: '#444', fontWeight: '600' },
  desc: { fontSize: 14, color: '#555', lineHeight: 20, marginTop: 2 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 12,
    marginTop: 6,
  },
  buyBtn: { backgroundColor: '#111' },
  cartBtn: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#111' },
  notifyBtn: { backgroundColor: '#B00020' },
  btnTextLight: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnTextDark: { color: '#111', fontWeight: '700', fontSize: 15 },
  viewLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 4,
  },
  viewLinkText: { color: Brand.colors.brandBlue, fontWeight: '600', fontSize: 14 },
});
