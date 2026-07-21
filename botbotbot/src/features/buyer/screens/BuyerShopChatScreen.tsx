import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiService, ChatMessage } from '@/services/api-fetch';
import {
  clearStoredSessionId,
  loadStoredSessionId,
  saveStoredSessionId,
} from '@/shared/utils/chatSession';
import { parseAgentResponse } from '@/shared/utils/parseTiles';
import { ProductTileGrid } from '@/features/chat-shared/components/ProductTileCard';
import BuyerTileDetailModal, {
  ShelfProduct,
} from '@/features/buyer/components/BuyerTileDetailModal';
import { TileProduct } from '@/shared/utils/parseTiles';
import { useApp } from '@/contexts/AppContext';
import { useCart } from '@/contexts/CartContext';
import { ThemedText } from '@/shared/ui/ThemedText';
import TypingDots from '@/shared/ui/TypingDots';
import { useKeyboardHeight } from '@/shared/hooks/useKeyboardHeight';
import BuyerNotifyFab from '@/features/buyer/components/BuyerNotifyFab';
import {
  buildBuyerAlerts,
  fetchBuyerInbox,
  type BuyerAlert,
} from '@/services/buyerNotifyApi';
import { fetchStoreProducts, type ApiSellerProduct } from '@/services/storesApi';

function categoryTag(category: string): string {
  const c = (category || '').toLowerCase();
  if (c.includes('skin')) return 'skincare';
  if (c.includes('apparel')) return 'apparels';
  return 'handicrafts';
}

export default function BuyerShopChatScreen() {
  const { category, storeId } = useLocalSearchParams<{
    category: string;
    storeId: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const { selectedStore, stores } = useApp();
  const { count: cartCount, cart } = useCart();
  const store =
    selectedStore?.id === storeId
      ? selectedStore
      : stores.find((s) => s.id === storeId) || null;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState(apiService.generateSessionId());
  const [sessionReady, setSessionReady] = useState(false);
  const [selectedTile, setSelectedTile] = useState<ShelfProduct | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [buyerAlerts, setBuyerAlerts] = useState<BuyerAlert[]>([]);
  const [storeProducts, setStoreProducts] = useState<ApiSellerProduct[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  const sessionKey = `buyer_${storeId}`;

  const openTile = (t: TileProduct) => {
    const sku = String(t.sku || t.id || '').replace(/^tile-/, '');
    const images = (t.images || []).map(String).filter(Boolean);
    if (t.img && !images.includes(t.img)) images.unshift(t.img);
    setSelectedTile({
      sku,
      name: t.name,
      price: t.price,
      list_price: t.list_price,
      img: t.img,
      images,
      url: t.url,
      category: t.category,
      description: t.description,
      quantity: typeof t.quantity === 'number' ? t.quantity : undefined,
      status: t.status,
      store_id: String(storeId),
    });
    setModalOpen(true);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSessionReady(false);
      const stored = await loadStoredSessionId(sessionKey);
      const id = stored || apiService.generateSessionId();
      setSessionId(id);
      const history = await apiService.getSessionHistory(id);
      if (cancelled) return;
      if (history?.messages?.length) {
        setMessages(
          history.messages.map((msg, index) => {
            const isUser = msg.role === 'user';
            const raw = msg.content || '';
            if (isUser) {
              return {
                id: `u-${index}`,
                text: raw,
                isUser: true,
                timestamp: new Date(),
              };
            }
            const parsed = parseAgentResponse(raw);
            return {
              id: `a-${index}`,
              text: msg.display || parsed.text,
              isUser: false,
              timestamp: new Date(),
              tiles: parsed.tiles,
            };
          }),
        );
      } else {
        setMessages([
          {
            id: 'welcome',
            text: `Welcome to ${store?.name || 'this shop'}! Ask about products from this store only.`,
            isUser: false,
            timestamp: new Date(),
          },
        ]);
      }
      await saveStoredSessionId(id, sessionKey);
      setSessionReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId, sessionKey, store?.name]);

  useEffect(() => {
    if (!sessionReady || !storeId) return;
    let cancelled = false;
    (async () => {
      const [inbox, products] = await Promise.all([
        fetchBuyerInbox(),
        fetchStoreProducts(String(storeId), true),
      ]);
      if (cancelled) return;
      setStoreProducts(products);
      setBuyerAlerts(
        buildBuyerAlerts({
          storeId: String(storeId),
          inbox,
          products,
          cartItems: cart.items,
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionReady, storeId, cart.items]);

  const openAlertProduct = (alert: BuyerAlert) => {
    const sku = String(alert.sku || '').toUpperCase();
    if (!sku) return;
    const p = storeProducts.find((row) => String(row.sku || '').toUpperCase() === sku);
    if (!p) return;
    const images = (p.images || []).map(String).filter(Boolean);
    if (p.img && !images.includes(p.img)) images.unshift(p.img);
    setSelectedTile({
      sku: p.sku,
      name: p.name,
      price: p.price,
      list_price: p.list_price,
      img: p.img,
      images,
      url: p.url,
      category: p.category,
      description: p.description,
      quantity: p.quantity ?? 0,
      status: p.status,
      store_id: String(storeId),
    });
    setModalOpen(true);
  };

  const send = async () => {
    const q = inputText.trim();
    if (!q || isLoading || !sessionReady) return;
    setInputText('');
    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), text: q, isUser: true, timestamp: new Date() },
    ]);
    setIsLoading(true);
    try {
      const response = await apiService.sendMessage(q, sessionId, {
        store: categoryTag(String(store?.category || category)),
        storeId: String(storeId),
        role: 'buyer',
      });
      if (response.session_id) {
        setSessionId(response.session_id);
        await saveStoredSessionId(response.session_id, sessionKey);
      }
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          text: response.displayText || response.answer || '',
          isUser: false,
          timestamp: new Date(),
          tiles: response.tiles,
        },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          text: e instanceof Error ? e.message : 'Request failed',
          isUser: false,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="arrow-back" size={22} color="#111" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <ThemedText style={styles.name} numberOfLines={1}>
            {store?.name || 'Shop'}
          </ThemedText>
          <ThemedText style={styles.tag}>{store?.category || category}</ThemedText>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => router.push(`/shelf/${storeId}`)}
            hitSlop={8}
            style={styles.shelfBtn}
          >
            <Ionicons name="grid-outline" size={16} color="#1D3557" />
            <Text style={styles.shelfText}>Shelf</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/cart')}
            hitSlop={8}
            style={styles.cartBtn}
          >
            <Ionicons name="cart-outline" size={22} color="#111" />
            {cartCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{cartCount}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={async () => {
              const id = apiService.generateSessionId();
              await clearStoredSessionId(sessionKey);
              await saveStoredSessionId(id, sessionKey);
              setSessionId(id);
              setMessages([
                {
                  id: 'welcome',
                  text: `New chat with ${store?.name || 'shop'}.`,
                  isUser: false,
                  timestamp: new Date(),
                },
              ]);
            }}
            hitSlop={8}
          >
            <Text style={styles.new}>New</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.chatBody}>
        <ScrollView
          ref={scrollRef}
          style={styles.messages}
          contentContainerStyle={{ padding: 12, paddingBottom: 20 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.map((m) => (
            <View key={m.id} style={{ marginBottom: 10 }}>
              <View style={[styles.bubble, m.isUser ? styles.user : styles.bot]}>
                <Text style={[styles.text, m.isUser && { color: '#fff' }]}>{m.text}</Text>
              </View>
              {!m.isUser && m.tiles?.length ? (
                <ProductTileGrid
                  tiles={m.tiles}
                  onTilePressOverride={openTile}
                />
              ) : null}
            </View>
          ))}
          {isLoading ? (
            <View style={[styles.bubble, styles.bot, styles.typingBubble]}>
              <TypingDots />
            </View>
          ) : null}
        </ScrollView>

        <View
          style={[
            styles.inputRow,
            {
              paddingBottom:
                keyboardHeight > 0 ? 8 : Math.max(insets.bottom, 8),
            },
          ]}
        >
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Ask about this shop's products…"
            placeholderTextColor="#999"
            onSubmitEditing={send}
            onFocus={() => {
              setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
            }}
          />
          <TouchableOpacity style={styles.send} onPress={send}>
            <Ionicons name="arrow-up" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
        {/* iOS: push composer above keyboard. Android resize mode handles this. */}
        {Platform.OS === 'ios' && keyboardHeight > 0 ? (
          <View style={{ height: keyboardHeight }} />
        ) : null}
      </View>

      <BuyerTileDetailModal
        product={selectedTile}
        visible={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setSelectedTile(null);
        }}
      />

      {sessionReady ? (
        <BuyerNotifyFab
          storeId={String(storeId)}
          storeName={store?.name}
          alerts={buyerAlerts}
          bottomOffset={keyboardHeight > 0 ? keyboardHeight - 40 : 0}
          onAlertPress={openAlertProduct}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  chatBody: { flex: 1 },
  messages: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
    gap: 8,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  name: { fontSize: 16, fontWeight: '700', color: '#111' },
  tag: { fontSize: 11, color: '#666', marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  shelfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EAF0F7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  shelfText: { color: '#1D3557', fontWeight: '700', fontSize: 12 },
  cartBtn: { padding: 2 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    backgroundColor: '#B00020',
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  new: { fontWeight: '700', color: '#1D3557', fontSize: 13 },
  bubble: {
    maxWidth: '88%',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  user: { alignSelf: 'flex-end', backgroundColor: '#111' },
  bot: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  text: { fontSize: 15, color: '#111', lineHeight: 21 },
  typing: { color: '#888', fontStyle: 'italic', marginLeft: 8 },
  typingBubble: { paddingVertical: 14, paddingHorizontal: 16 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 8,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#EEE',
  },
  input: {
    flex: 1,
    backgroundColor: '#F3F3F3',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111',
  },
  send: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
