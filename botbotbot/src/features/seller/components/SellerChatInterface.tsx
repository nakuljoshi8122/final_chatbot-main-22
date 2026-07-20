import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  Image,
  Alert,
  Animated,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiService } from '@/services/api-fetch';
import {
  clearStoredSessionId,
  loadStoredSessionId,
  saveStoredSessionId,
} from '@/shared/utils/chatSession';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardHeight } from '@/shared/hooks/useKeyboardHeight';
import { ProductTileGrid } from '@/features/chat-shared/components/ProductTileCard';
import { parseAgentResponse, TileProduct } from '@/shared/utils/parseTiles';
import SellerTileDetailModal from '@/features/seller/components/SellerTileDetailModal';
import SellerAddProductCard, {
  AddProductSummary,
  AddProductSummaryCard,
} from '@/features/seller/components/SellerAddProductCard';
import TypingDots from '@/shared/ui/TypingDots';
import {
  LastListedProduct,
  loadLastListed,
  loadDoneToday,
  saveDoneToday,
  loadTopMovers,
  bumpStarterStat,
  bumpMover,
  appendChangeLog,
  DoneToday,
} from '@/services/sellerLazyStore';
import { patchSellerProduct } from '@/services/patchSellerProduct';
import UndoToast from '@/shared/ui/UndoToast';
import SellerMorningBrief from '@/features/seller/components/SellerMorningBrief';
import { fetchStoreProducts, fetchStoreQueries } from '@/services/storesApi';
import { tapHaptic, successHaptic } from '@/shared/utils/sellerHaptics';
import { useRouter } from 'expo-router';

type Props = {
  storeId: string;
  storeName: string;
  category: string;
  /** Open the add-product form once the chat is ready (from Add tab). */
  autoOpenAdd?: boolean;
};

type SellerMsg = {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: string;
  imageUri?: string;
  tiles?: TileProduct[];
  /** Interactive field-tile listing form (lazy-seller friendly). */
  addProductForm?: boolean;
  addProductSummary?: AddProductSummary;
  formPhoto?: { uri: string; base64?: string };
  formPrefill?: Partial<LastListedProduct>;
  formQueue?: { uri: string; base64?: string }[];
  formKey?: string;
};

type QuickAction = {
  label: string;
  message: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Opens the in-chat add-product form instead of sending to the agent. */
  openAddForm?: boolean;
};

const QUICK_ACTIONS: QuickAction[] = [
  { label: 'My items', message: 'Show my items', icon: 'grid-outline' },
  { label: 'Drafts', message: 'Show my draft items', icon: 'document-outline' },
  {
    label: 'Add',
    message: 'I wanna add a product',
    icon: 'add-circle-outline',
    openAddForm: true,
  },
  {
    label: 'Snap',
    message: '__SNAP__',
    icon: 'camera-outline',
    openAddForm: true,
  },
  { label: 'Low stock', message: 'Which items are low on stock?', icon: 'alert-circle-outline' },
  {
    label: 'Similar',
    message: '__SIMILAR__',
    icon: 'copy-outline',
    openAddForm: true,
  },
  {
    label: 'Publish drafts',
    message: 'Publish all my draft items to active',
    icon: 'checkmark-done-outline',
  },
];

/** ChatGPT-style starter tiles — short labels, zero essay. */
const STARTER_SUGGESTIONS: QuickAction[] = [
  {
    label: 'Add a product',
    message: 'I wanna add a product',
    icon: 'add-circle-outline',
    openAddForm: true,
  },
  {
    label: 'Snap & list',
    message: '__SNAP__',
    icon: 'camera-outline',
    openAddForm: true,
  },
  { label: 'Show my items', message: 'Show my items', icon: 'grid-outline' },
  {
    label: 'Low stock',
    message: 'Which items are low on stock?',
    icon: 'alert-circle-outline',
  },
  { label: 'Open drafts', message: 'Show my draft items', icon: 'document-outline' },
];

/** Survive tab switches without losing the thread. */
const memoryCache = new Map<string, { sessionId: string; messages: SellerMsg[] }>();

function categoryTag(category: string): string {
  const c = category.toLowerCase();
  if (c.includes('skin')) return 'skincare';
  if (c.includes('apparel')) return 'apparels';
  return 'handicrafts';
}

function cacheKey(storeId: string) {
  return `seller_chat_msgs_${storeId}`;
}

async function persistLocal(storeId: string, sessionId: string, messages: SellerMsg[]) {
  memoryCache.set(storeId, { sessionId, messages });
  try {
    await AsyncStorage.setItem(
      cacheKey(storeId),
      JSON.stringify({ sessionId, messages }),
    );
  } catch {
    // ignore
  }
}

async function loadLocal(storeId: string): Promise<{
  sessionId: string;
  messages: SellerMsg[];
} | null> {
  const mem = memoryCache.get(storeId);
  if (mem?.messages?.length) return mem;
  try {
    const raw = await AsyncStorage.getItem(cacheKey(storeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.messages?.length) {
      memoryCache.set(storeId, parsed);
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

/** Wraps a chat row so it fades + slides up into place on mount (matches tile motion). */
function AnimatedRow({ children }: { children: React.ReactNode }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim]);
  return (
    <Animated.View
      style={[
        styles.msgRow,
        {
          opacity: anim,
          transform: [
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

export default function SellerChatInterface({
  storeId,
  storeName,
  category,
  autoOpenAdd = false,
}: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const [messages, setMessages] = useState<SellerMsg[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState(apiService.generateSessionId());
  const [sessionReady, setSessionReady] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ uri: string; base64: string } | null>(
    null,
  );
  const [selectedTile, setSelectedTile] = useState<TileProduct | null>(null);
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(
    null,
  );
  const [brief, setBrief] = useState({ lowStock: 0, drafts: 0, queries: 0 });
  const [doneToday, setDoneToday] = useState<DoneToday>({});
  const [movers, setMovers] = useState<{ name: string; count: number }[]>([]);
  const [smartStarters, setSmartStarters] = useState(STARTER_SUGGESTIONS);
  const scrollRef = useRef<ScrollView>(null);
  const tileAnims = useRef(STARTER_SUGGESTIONS.map(() => new Animated.Value(1))).current;
  const starterExiting = useRef(false);
  const autoOpenedRef = useRef(false);
  const sessionKey = `seller_${storeId}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSessionReady(false);

      const local = await loadLocal(storeId);
      if (cancelled) return;

      if (local?.messages?.length) {
        setSessionId(local.sessionId);
        setMessages(local.messages);
        await saveStoredSessionId(local.sessionId, sessionKey);
        setSessionReady(true);
        return;
      }

      const stored = await loadStoredSessionId(sessionKey);
      const id = stored || apiService.generateSessionId();
      setSessionId(id);
      await saveStoredSessionId(id, sessionKey);

      // Restore text history from server if available
      const history = await apiService.getSessionHistory(id);
      if (cancelled) return;

      let restored: SellerMsg[] = [];
      if (history?.messages?.length) {
        restored = history.messages.map((msg, index) => {
          const isUser = msg.role === 'user';
          const raw = msg.content || msg.display || '';
          if (isUser) {
            return {
              id: `hist-${index}`,
              text: msg.display || msg.content || '',
              isUser: true,
              timestamp: msg.ts || new Date().toISOString(),
            };
          }
          const parsed = parseAgentResponse(raw);
          return {
            id: `hist-${index}`,
            text: parsed.text || msg.display || '',
            isUser: false,
            timestamp: msg.ts || new Date().toISOString(),
            tiles: parsed.tiles.length ? parsed.tiles : undefined,
          };
        });
      }
      // Empty chat: show ChatGPT-style starter tiles instead of a welcome bubble.
      setMessages(restored);
      if (restored.length) await persistLocal(storeId, id, restored);
      setSessionReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId, storeName, sessionKey]);

  // Keep local cache updated whenever messages change after ready
  useEffect(() => {
    if (!sessionReady || !messages.length) return;
    void persistLocal(storeId, sessionId, messages);
  }, [messages, sessionId, storeId, sessionReady]);

  const pickImage = async (fromCamera = false) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to upload product images.');
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({
          quality: 0.35,
          allowsEditing: true,
          aspect: [1, 1],
          base64: true,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.35,
          allowsEditing: true,
          aspect: [1, 1],
          base64: true,
        });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    let base64 = asset.base64 || '';
    if (!base64 && asset.uri) {
      try {
        base64 = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } catch {
        Alert.alert('Error', 'Could not read image.');
        return;
      }
    }
    if (!base64) {
      Alert.alert('Error', 'Could not encode image.');
      return;
    }
    // Camera / gallery for listing → open form immediately (lazy path)
    openAddProductForm(
      fromCamera ? 'Snap & list' : 'List this from the photo',
      { uri: asset.uri, base64 },
    );
  };

  const openAddProductForm = (
    userLabel = 'I wanna add a product',
    photo?: { uri: string; base64?: string } | null,
    prefill?: Partial<LastListedProduct> | null,
  ) => {
    const userMsg: SellerMsg = {
      id: `u-${Date.now()}`,
      text: photo ? userLabel : userLabel,
      isUser: true,
      timestamp: new Date().toISOString(),
      imageUri: photo?.uri,
    };
    const formMsg: SellerMsg = {
      id: `form-${Date.now() + 1}`,
      text: photo
        ? 'Photo ready — finish basics.'
        : prefill
          ? 'Similar listing — tweak & list.'
          : 'Quick add — 3 steps.',
      isUser: false,
      timestamp: new Date().toISOString(),
      addProductForm: true,
      formPhoto: photo || undefined,
      formPrefill: prefill || undefined,
    };
    setMessages((prev) => {
      const next = [...prev, userMsg, formMsg];
      void persistLocal(storeId, sessionId, next);
      return next;
    });
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  };

  const openSimilar = async () => {
    const last = await loadLastListed(storeId);
    if (!last) {
      openAddProductForm('I wanna add a product');
      setToast({ message: 'No previous item — starting blank' });
      return;
    }
    openAddProductForm('List similar', null, {
      ...last,
      name: '', // force a new name so they don't duplicate SKU confusion
    });
  };

  const bulkRestock = async (tiles: TileProduct[], amount = 5) => {
    const targets = tiles.filter((t) => (t.quantity ?? 0) < 3 && t.sku);
    if (!targets.length) {
      setToast({ message: 'Nothing low to restock' });
      return;
    }
    const prev = targets.map((t) => ({ sku: t.sku!, qty: t.quantity ?? 0, t }));
    for (const t of targets) {
      const next = (t.quantity ?? 0) + amount;
      await patchSellerProduct({
        sku: String(t.sku),
        name: t.name,
        store_id: storeId,
        category: t.category,
        description: t.description,
        img: t.img,
        price: t.price,
        quantity: next,
        status: t.status || 'active',
      });
    }
    setToast({
      message: `Restocked ${targets.length} item(s) +${amount}`,
      undo: () => {
        void (async () => {
          for (const p of prev) {
            await patchSellerProduct({
              sku: String(p.sku),
              name: p.t.name,
              store_id: storeId,
              category: p.t.category,
              description: p.t.description,
              img: p.t.img,
              price: p.t.price,
              quantity: p.qty,
              status: p.t.status || 'active',
            });
          }
        })();
      },
    });
    void send('Show my items');
  };

  const bulkPublish = async (tiles: TileProduct[]) => {
    const drafts = tiles.filter(
      (t) => String(t.status || '').toLowerCase() === 'draft' && t.sku,
    );
    if (!drafts.length) {
      setToast({ message: 'No drafts in this list' });
      return;
    }
    for (const t of drafts) {
      await patchSellerProduct({
        sku: String(t.sku),
        name: t.name,
        store_id: storeId,
        category: t.category,
        description: t.description,
        img: t.img,
        price: t.price,
        quantity: t.quantity ?? 0,
        status: 'active',
      });
    }
    setToast({ message: `Published ${drafts.length} draft(s)` });
    void send('Show my items');
  };

  useEffect(() => {
    if (!autoOpenAdd || !sessionReady || autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    // Slight delay so empty-state starters can clear / chat can mount
    const t = setTimeout(() => openAddProductForm('I wanna add a product'), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenAdd, sessionReady]);

  useEffect(() => {
    if (!sessionReady) return;
    let cancelled = false;
    (async () => {
      const [products, queries, done, top] = await Promise.all([
        fetchStoreProducts(storeId, false),
        fetchStoreQueries(storeId, 'open'),
        loadDoneToday(storeId),
        loadTopMovers(storeId, 3),
      ]);
      if (cancelled) return;
      const low = products.filter(
        (p: { status?: string; quantity?: number }) =>
          String(p.status || 'active').toLowerCase() === 'active' &&
          (p.quantity ?? 0) < 3,
      ).length;
      const drafts = products.filter(
        (p: { status?: string }) => String(p.status || '').toLowerCase() === 'draft',
      ).length;
      setBrief({ lowStock: low, drafts, queries: queries.length });
      setDoneToday(done);
      setMovers(top);

      // Smart starters: put the urgent job first
      const base = [...STARTER_SUGGESTIONS];
      if (low > 0 && !done.lowStock) {
        const idx = base.findIndex((s) => s.message.includes('low on stock'));
        if (idx > 0) {
          const [item] = base.splice(idx, 1);
          base.unshift({ ...item, label: 'Restock low' });
        }
      } else if (drafts > 0 && !done.drafts) {
        const idx = base.findIndex((s) => s.message.includes('draft'));
        if (idx > 0) {
          const [item] = base.splice(idx, 1);
          base.unshift({ ...item, label: 'Publish drafts' });
        }
      }
      setSmartStarters(base);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionReady, storeId, messages.length]);

  const send = async (overrideText?: string) => {
    const text = (overrideText ?? inputText).trim();
    if ((!text && !pendingImage) || isLoading || !sessionReady) return;

    // Photo alone (or photo + "add") → field-tile form with photo prefilled.
    if (pendingImage) {
      const wantsList =
        !text ||
        /^(list|add|create|upload|this|product)\b/i.test(text) ||
        /add\s+(a\s+)?(new\s+)?product/i.test(text);
      if (wantsList) {
        const photo = pendingImage;
        setPendingImage(null);
        setInputText('');
        openAddProductForm(text || 'List this from the photo', photo);
        return;
      }
    }

    // Typed "add product" (no photo) → form
    if (
      !pendingImage &&
      /^(i\s*(wanna|want to|would like to)\s+)?(add|list|create)\s+(a\s+)?(new\s+)?product\b/i.test(
        text,
      )
    ) {
      setInputText('');
      openAddProductForm(text);
      return;
    }

    const display = text || 'Please help me list this product from the photo.';
    const imageUri = pendingImage?.uri;
    const imageB64 = pendingImage?.base64;
    const userMsg: SellerMsg = {
      id: Date.now().toString(),
      text: display,
      isUser: true,
      timestamp: new Date().toISOString(),
      imageUri,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputText('');
    setPendingImage(null);
    setIsLoading(true);

    try {
      const response = await apiService.sendMessage(display, sessionId, {
        store: categoryTag(category),
        storeId,
        role: 'seller',
        imageBase64: imageB64,
      });
      const nextSession = response.session_id || sessionId;
      if (response.session_id) {
        setSessionId(response.session_id);
        await saveStoredSessionId(response.session_id, sessionKey);
      }
      setMessages((prev) => {
        const next = [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            text: response.displayText || response.answer || '',
            isUser: false,
            timestamp: new Date().toISOString(),
            tiles: response.tiles?.length ? response.tiles : undefined,
          },
        ];
        void persistLocal(storeId, nextSession, next);
        return next;
      });
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          text: e instanceof Error ? e.message : 'Request failed.',
          isUser: false,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  const selectStarter = (action: QuickAction) => {
    if (isLoading || !sessionReady || starterExiting.current) return;
    starterExiting.current = true;
    // Tiles leave one-by-one (staggered), THEN the message/form appears.
    Animated.stagger(
      70,
      tileAnims.map((v) =>
        Animated.timing(v, {
          toValue: 0,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ),
    ).start(() => {
      starterExiting.current = false;
      if (action.message === '__SNAP__') {
        void pickImage(true);
      } else if (action.message === '__SIMILAR__') {
        void openSimilar();
      } else if (action.openAddForm) {
        openAddProductForm(action.message);
      } else {
        void send(action.message);
      }
    });
  };

  const newChat = async () => {
    const id = apiService.generateSessionId();
    await clearStoredSessionId(sessionKey);
    await saveStoredSessionId(id, sessionKey);
    setSessionId(id);
    starterExiting.current = false;
    tileAnims.forEach((v) => v.setValue(1));
    setMessages([]);
    memoryCache.set(storeId, { sessionId: id, messages: [] });
    try {
      await AsyncStorage.removeItem(cacheKey(storeId));
    } catch {
      // ignore
    }
    setPendingImage(null);
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.newChatBtn}
          onPress={newChat}
          hitSlop={8}
          activeOpacity={0.7}
        >
          <Ionicons name="create-outline" size={16} color="#1D3557" />
          <Text style={styles.newChatText}>New chat</Text>
        </TouchableOpacity>
      </View>

      {sessionReady && messages.length === 0 ? (
        <View style={styles.emptyBody}>
          {/* Ambient pulse — background only; gone once any chat text appears */}
          <SellerMorningBrief
            storeName={storeName}
            stats={{
              lowStock: brief.lowStock,
              drafts: brief.drafts,
              queries: brief.queries,
              movers,
            }}
            done={doneToday}
            onLowStock={() => {
              void bumpStarterStat(storeId, 'Low stock');
              void send('Which items are low on stock?');
            }}
            onDrafts={() => {
              void bumpStarterStat(storeId, 'Drafts');
              void send('Show my draft items');
            }}
            onQueries={() => router.push(`/seller/${storeId}/queries` as never)}
            onDoneToday={async () => {
              const next = { lowStock: true, drafts: true, queries: true };
              setDoneToday(next);
              await saveDoneToday(storeId, next);
              successHaptic();
              setToast({ message: 'Marked done for today ✓' });
            }}
          />
          <View style={styles.starterHeader}>
            <Text style={styles.starterTitle}>What do you need?</Text>
            <Text style={styles.starterSub}>One tap. No essays.</Text>
          </View>
          <View style={styles.starterList}>
            {smartStarters.map((s, i) => (
              <Animated.View
                key={s.label}
                style={{
                  opacity: tileAnims[i] || tileAnims[0],
                  transform: [
                    {
                      translateY: (tileAnims[i] || tileAnims[0]).interpolate({
                        inputRange: [0, 1],
                        outputRange: [14, 0],
                      }),
                    },
                  ],
                }}
              >
                <TouchableOpacity
                  style={styles.starterTile}
                  onPress={() => {
                    tapHaptic();
                    void bumpStarterStat(storeId, s.label);
                    selectStarter(s);
                  }}
                  disabled={isLoading || !sessionReady}
                  activeOpacity={0.7}
                >
                  <View style={styles.starterIcon}>
                    <Ionicons name={s.icon} size={16} color="#1D3557" />
                  </View>
                  <Text style={styles.starterText}>{s.label}</Text>
                  <Ionicons name="arrow-forward" size={15} color="#C2CBD6" />
                </TouchableOpacity>
              </Animated.View>
            ))}
          </View>
        </View>
      ) : (
      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={{ padding: 12, paddingBottom: 20 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.map((m) => (
          <AnimatedRow key={m.id}>
            {m.text || m.imageUri ? (
              <View
                style={[
                  styles.bubble,
                  m.isUser ? styles.userBubble : styles.botBubble,
                  !m.isUser && styles.botAlign,
                ]}
              >
                {m.imageUri ? (
                  <Image source={{ uri: m.imageUri }} style={styles.bubbleImage} />
                ) : null}
                {m.text ? (
                  <Text style={[styles.bubbleText, m.isUser && styles.userText]}>{m.text}</Text>
                ) : null}
              </View>
            ) : null}
            {!m.isUser && m.tiles?.length ? (
              <View>
                <ProductTileGrid
                  tiles={m.tiles}
                  onTilePressOverride={(t) => {
                    tapHaptic();
                    void bumpMover(storeId, String(t.sku || t.id), t.name);
                    setSelectedTile(t);
                  }}
                />
                <View style={styles.bulkRow}>
                  {m.tiles.some((t) => (t.quantity ?? 99) < 3) ? (
                    <TouchableOpacity
                      style={styles.bulkChip}
                      onPress={() => void bulkRestock(m.tiles!, 5)}
                    >
                      <Text style={styles.bulkChipText}>Restock all +5</Text>
                    </TouchableOpacity>
                  ) : null}
                  {m.tiles.some(
                    (t) => String(t.status || '').toLowerCase() === 'draft',
                  ) ? (
                    <TouchableOpacity
                      style={styles.bulkChip}
                      onPress={() => void bulkPublish(m.tiles!)}
                    >
                      <Text style={styles.bulkChipText}>Publish all</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : null}
            {!m.isUser && m.addProductForm ? (
              <SellerAddProductCard
                key={m.formKey || m.id}
                storeId={storeId}
                defaultCategory={category}
                initialPhoto={m.formPhoto || null}
                prefills={m.formPrefill || null}
                initialQueue={m.formQueue || []}
                onListed={async (item, summary, meta) => {
                  successHaptic();
                  await appendChangeLog(storeId, `Listed ${summary.name}`, summary.sku);
                  if (meta?.continueBatch && meta.nextPhoto) {
                    setMessages((prev) => {
                      const next = prev.map((msg) =>
                        msg.id === m.id
                          ? {
                              ...msg,
                              text: `${summary.name} listed — next photo ready.`,
                              formPhoto: meta.nextPhoto,
                              formPrefill: undefined,
                              formQueue: meta.remaining || [],
                              formKey: `${Date.now()}`,
                              addProductForm: true,
                              addProductSummary: undefined,
                            }
                          : msg,
                      );
                      void persistLocal(storeId, sessionId, next);
                      return next;
                    });
                    setToast({
                      message: `${summary.name} saved · next in batch`,
                      undo: () => {
                        void (async () => {
                          const { permanentlyDeleteInventoryItem } = await import(
                            '@/services/inventoryStore'
                          );
                          await permanentlyDeleteInventoryItem(summary.sku);
                          setToast({ message: 'Listing undone' });
                        })();
                      },
                    });
                    return;
                  }
                  setMessages((prev) => {
                    const next = prev.map((msg) =>
                      msg.id === m.id
                        ? {
                            ...msg,
                            text: `${summary.name} listed.`,
                            addProductForm: false,
                            addProductSummary: summary,
                            formPhoto: undefined,
                            formPrefill: undefined,
                            formQueue: undefined,
                          }
                        : msg,
                    );
                    void persistLocal(storeId, sessionId, next);
                    return next;
                  });
                  setToast({
                    message: `${summary.name} saved ✓`,
                    undo: () => {
                      void (async () => {
                        const { permanentlyDeleteInventoryItem } = await import(
                          '@/services/inventoryStore'
                        );
                        await permanentlyDeleteInventoryItem(summary.sku);
                        setToast({ message: 'Listing undone' });
                      })();
                    },
                  });
                  setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
                }}
              />
            ) : null}
            {!m.isUser && m.addProductSummary ? (
              <AddProductSummaryCard
                summary={m.addProductSummary}
                onAddAnother={() => openAddProductForm('Add another product')}
                onListSimilar={() =>
                  void openAddProductForm('List similar', null, {
                    name: '',
                    price: m.addProductSummary!.price,
                    category: m.addProductSummary!.category,
                    quantity: m.addProductSummary!.quantity,
                  })
                }
              />
            ) : null}
          </AnimatedRow>
        ))}
        {isLoading ? (
          <View style={[styles.bubble, styles.botBubble, styles.botAlign, styles.typingBubble]}>
            <TypingDots />
          </View>
        ) : null}
      </ScrollView>
      )}

      {pendingImage ? (
        <View style={styles.previewRow}>
          <Image source={{ uri: pendingImage.uri }} style={styles.preview} />
          <Text style={styles.previewLabel}>Photo ready to send</Text>
          <TouchableOpacity onPress={() => setPendingImage(null)}>
            <Ionicons name="close-circle" size={22} color="#c00" />
          </TouchableOpacity>
        </View>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.quickRow}
        contentContainerStyle={styles.quickContent}
        keyboardShouldPersistTaps="handled"
      >
        {QUICK_ACTIONS.map((qa) => (
          <TouchableOpacity
            key={qa.label}
            style={styles.quickChip}
            onPress={() => {
              if (qa.message === '__SNAP__') void pickImage(true);
              else if (qa.message === '__SIMILAR__') void openSimilar();
              else if (qa.openAddForm) openAddProductForm(qa.message);
              else void send(qa.message);
            }}
            disabled={isLoading || !sessionReady}
          >
            <Ionicons name={qa.icon} size={14} color="#1D3557" />
            <Text style={styles.quickChipText}>{qa.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View
        style={[
          styles.inputRow,
          {
            paddingBottom: keyboardHeight > 0 ? 8 : Math.max(insets.bottom, 8),
          },
        ]}
      >
        <TouchableOpacity style={styles.iconBtn} onPress={() => void pickImage(true)}>
          <Ionicons name="camera-outline" size={22} color="#1D3557" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={() => void pickImage(false)}>
          <Ionicons name="image-outline" size={22} color="#1D3557" />
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="List a product, update price…"
          placeholderTextColor="#999"
          multiline
          onFocus={() => {
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
          }}
        />
        <TouchableOpacity style={styles.sendBtn} onPress={() => send()} disabled={isLoading}>
          <Ionicons name="arrow-up" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
      {Platform.OS === 'ios' && keyboardHeight > 0 ? (
        <View style={{ height: keyboardHeight }} />
      ) : null}

      <SellerTileDetailModal
        product={selectedTile}
        storeId={storeId}
        onClose={() => setSelectedTile(null)}
      />
      <UndoToast
        message={toast?.message ?? null}
        onUndo={toast?.undo}
        onDismiss={() => setToast(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
  },
  newChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#EEF2F7',
  },
  newChatText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1D3557',
  },
  messages: { flex: 1 },
  emptyBody: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  starterHeader: {
    marginBottom: 12,
    gap: 3,
    paddingHorizontal: 2,
  },
  starterTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111',
  },
  starterSub: { fontSize: 12.5, color: '#8A8A8A' },
  starterList: { gap: 8 },
  starterTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#EAEAEA',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  starterIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#EEF2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  starterText: { flex: 1, fontSize: 14, fontWeight: '600', color: '#222' },
  typingBubble: { paddingVertical: 14, paddingHorizontal: 16 },
  msgRow: { marginBottom: 8 },
  bubble: {
    maxWidth: '85%',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  botAlign: { alignSelf: 'flex-start' },
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#111' },
  botBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  bubbleImage: {
    width: 180,
    height: 180,
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: '#333',
  },
  bubbleText: { fontSize: 15, color: '#111', lineHeight: 21 },
  userText: { color: '#fff' },
  typing: { color: '#888', fontStyle: 'italic', marginLeft: 8 },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#fff',
  },
  preview: { width: 56, height: 56, borderRadius: 8 },
  previewLabel: { flex: 1, fontSize: 13, color: '#555' },
  quickRow: {
    maxHeight: 44,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  quickContent: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 8,
    alignItems: 'center',
  },
  quickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#EEF2F7',
    borderRadius: 999,
    marginRight: 8,
  },
  quickChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1D3557',
  },
  bulkRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  bulkChip: {
    backgroundColor: '#1D3557',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  bulkChipText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 8,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#EEE',
  },
  iconBtn: { padding: 8 },
  input: {
    flex: 1,
    maxHeight: 100,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F3F3F3',
    borderRadius: 18,
    fontSize: 15,
    color: '#111',
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1D3557',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
});
