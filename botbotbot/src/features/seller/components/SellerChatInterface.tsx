import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  loadFormDraft,
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
import SellerAiBriefFab from '@/features/seller/components/SellerAiBriefFab';
import { fetchStoreProducts, fetchStoreQueries } from '@/services/storesApi';
import { fetchAiMorningBrief, fetchAiChatSuggestions } from '@/services/sellerAiApi';
import { tapHaptic, successHaptic } from '@/shared/utils/sellerHaptics';
import { useRouter } from 'expo-router';
import { GlassPane } from '@/shared/ui/Glass';
import { Glass } from '@/shared/theme/LiquidGlass';
import { SellerTheme } from '@/shared/theme/SellerTheme';
import SellerNextSuggestion, {
  ChatSuggestion,
} from '@/features/seller/components/SellerNextSuggestion';

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
  formDraftSku?: string;
  /** Agent-applied draft fields for this form instance. */
  chatFormSync?: {
    name?: string;
    price?: string;
    quantity?: string;
    category?: string;
    description?: string;
    sku?: string;
  };
  /** Bot prompt after photo upload: list vs agent query. */
  photoChoice?: boolean;
  photoChoiceResolved?: boolean;
  photoChoiceUserMsgId?: string;
};

type QuickAction = {
  label: string;
  message: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Opens the in-chat add-product form instead of sending to the agent. */
  openAddForm?: boolean;
};

const DAY_START_FALLBACK: ChatSuggestion[] = [
  {
    label: 'Morning priorities',
    message: 'What should I focus on first today for my store?',
  },
  {
    label: 'Check low stock',
    message: 'Which items are low on stock?',
  },
  {
    label: 'Review drafts',
    message: 'Show my draft items so I can publish them.',
  },
  {
    label: 'Add a product',
    message: 'I want to add a new product — walk me through it.',
  },
  {
    label: 'Top sellers',
    message: 'What sold best in my store recently?',
  },
];

/** ChatGPT-style starter tiles — keep to three jobs. */
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
  {
    label: 'Low stock',
    message: 'Which items are low on stock?',
    icon: 'alert-circle-outline',
  },
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

type ListingFormSync = {
  name?: string;
  price?: string;
  quantity?: string;
  category?: string;
  description?: string;
  sku?: string;
};

/** Keep one listing form pinned below the latest chat turn with synced fields. */
function pinListingFormToBottom(messages: SellerMsg[], sync: ListingFormSync): SellerMsg[] {
  const next = [...messages];
  const idx = next.findIndex((m) => !m.isUser && m.addProductForm && !m.addProductSummary);
  const prefill: Partial<LastListedProduct> = {
    name: sync.name,
    price: sync.price,
    quantity: sync.quantity != null ? Number(sync.quantity) : undefined,
    category: sync.category,
    description: sync.description,
  };
  const formSync: ListingFormSync = { ...sync };
  let formMsg: SellerMsg;
  if (idx >= 0) {
    formMsg = {
      ...next[idx],
      text: 'Draft updated — tweak here or in chat, then tap List product.',
      addProductForm: true,
      chatFormSync: formSync,
      formPrefill: prefill,
      formDraftSku: sync.sku,
      formKey: `form-${Date.now()}`,
    };
    next.splice(idx, 1);
  } else {
    formMsg = {
      id: `form-${Date.now()}`,
      text: 'Finish listing — tweak here or in chat, then tap List product.',
      isUser: false,
      timestamp: new Date().toISOString(),
      addProductForm: true,
      chatFormSync: formSync,
      formPrefill: prefill,
      formDraftSku: sync.sku,
    };
  }
  return [...next, formMsg];
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
  /** User bubble that already shows the photo — avoid duplicating on send/list. */
  const [photoUserMsgId, setPhotoUserMsgId] = useState<string | null>(null);
  const [selectedTile, setSelectedTile] = useState<TileProduct | null>(null);
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(
    null,
  );
  const [brief, setBrief] = useState({ lowStock: 0, drafts: 0, queries: 0 });
  const [aiNarrative, setAiNarrative] = useState('');
  const [aiPriorities, setAiPriorities] = useState<
    { sku: string; name: string; reason: string }[]
  >([]);
  const [doneToday, setDoneToday] = useState<DoneToday>({});
  const [movers, setMovers] = useState<{ name: string; count: number }[]>([]);
  const [smartStarters, setSmartStarters] = useState(STARTER_SUGGESTIONS);
  const [nextSuggestions, setNextSuggestions] =
    useState<ChatSuggestion[]>(DAY_START_FALLBACK);
  const listingDraftRef = useRef<{
    in_progress?: boolean;
    name?: string;
    price?: string;
    quantity?: string;
    category?: string;
    description?: string;
    hasPhoto?: boolean;
    source?: string;
    sku?: string;
  }>({});
  const handleListingDraftChange = useCallback(
    (draft: {
      in_progress: boolean;
      name?: string;
      price?: string;
      quantity?: string;
      category?: string;
      description?: string;
      hasPhoto?: boolean;
      source?: string;
      sku?: string;
    }) => {
      listingDraftRef.current = draft;
    },
    [],
  );
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
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

  const pickImage = async (
    fromCamera = false,
    opts?: { directList?: boolean },
  ) => {
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
    const photo = { uri: asset.uri, base64 };
    if (opts?.directList) {
      openAddProductForm(
        fromCamera ? 'Snap & list' : 'List this from the photo',
        photo,
      );
      return;
    }
    showPhotoChoice(photo, fromCamera);
  };

  const showPhotoChoice = (
    photo: { uri: string; base64: string },
    fromCamera = false,
  ) => {
    const userId = `u-${Date.now()}`;
    const userMsg: SellerMsg = {
      id: userId,
      text: fromCamera ? 'Snap & list' : 'Shared a photo',
      isUser: true,
      timestamp: new Date().toISOString(),
      imageUri: photo.uri,
    };
    const choiceMsg: SellerMsg = {
      id: `choice-${Date.now() + 1}`,
      text: 'What do you want to do with this image?',
      isUser: false,
      timestamp: new Date().toISOString(),
      photoChoice: true,
      formPhoto: photo,
      photoChoiceUserMsgId: userId,
    };
    setPhotoUserMsgId(null);
    setPendingImage(null);
    setMessages((prev) => {
      const next = [...prev, userMsg, choiceMsg];
      void persistLocal(storeId, sessionId, next);
      return next;
    });
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  };

  const resolvePhotoChoice = (choiceMsgId: string) => {
    setMessages((prev) => {
      const next = prev.map((msg) =>
        msg.id === choiceMsgId ? { ...msg, photoChoiceResolved: true } : msg,
      );
      void persistLocal(storeId, sessionId, next);
      return next;
    });
  };

  const handlePhotoChoiceList = (
    photo: { uri: string; base64?: string },
    choiceMsgId: string,
    userMsgId: string,
  ) => {
    tapHaptic();
    resolvePhotoChoice(choiceMsgId);
    openAddProductForm('List this from the photo', photo, null, {
      skipUserBubble: true,
      existingUserMsgId: userMsgId,
    });
  };

  const handlePhotoChoiceQuery = (
    photo: { uri: string; base64?: string },
    choiceMsgId: string,
    userMsgId: string,
  ) => {
    tapHaptic();
    setPendingImage({ uri: photo.uri, base64: photo.base64 || '' });
    setPhotoUserMsgId(userMsgId);
    setMessages((prev) => {
      const next = prev.map((msg) =>
        msg.id === choiceMsgId
          ? {
              ...msg,
              photoChoiceResolved: true,
              text: 'Type your question below — your photo is attached.',
            }
          : msg,
      );
      void persistLocal(storeId, sessionId, next);
      return next;
    });
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const openAddProductForm = (
    userLabel = 'I wanna add a product',
    photo?: { uri: string; base64?: string } | null,
    prefill?: Partial<LastListedProduct> | null,
    opts?: { skipUserBubble?: boolean; existingUserMsgId?: string },
  ) => {
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
      let next = prev;
      if (opts?.skipUserBubble && opts.existingUserMsgId) {
        next = prev.map((msg) =>
          msg.id === opts.existingUserMsgId ? { ...msg, text: userLabel } : msg,
        );
      } else {
        const userMsg: SellerMsg = {
          id: `u-${Date.now()}`,
          text: userLabel,
          isUser: true,
          timestamp: new Date().toISOString(),
          imageUri: photo?.uri,
        };
        next = [...prev, userMsg];
      }
      next = [...next, formMsg];
      void persistLocal(storeId, sessionId, next);
      return next;
    });
    if (opts?.existingUserMsgId) setPhotoUserMsgId(null);
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
      try {
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

        const aiBrief = await fetchAiMorningBrief(storeId);
        if (!cancelled && aiBrief?.narrative) {
          setAiNarrative(aiBrief.narrative);
          setAiPriorities(aiBrief.priorities || []);
          if (aiBrief.stats) {
            setBrief({
              lowStock: aiBrief.stats.lowStock ?? low,
              drafts: aiBrief.stats.drafts ?? drafts,
              queries: aiBrief.stats.queries ?? queries.length,
            });
          }
        }

        // Smart starters: urgent job first, max 3
        const base = [...STARTER_SUGGESTIONS];
        if (low > 0 && !done.lowStock) {
          const idx = base.findIndex((s) => s.message.includes('low on stock'));
          if (idx > 0) {
            const [item] = base.splice(idx, 1);
            base.unshift({ ...item, label: 'Restock low' });
          }
        } else if (drafts > 0 && !done.drafts) {
          base[2] = {
            label: 'Publish drafts',
            message: 'Show my draft items',
            icon: 'document-outline',
          };
        }
        setSmartStarters(base.slice(0, 3));
      } catch {
        // Keep seller chat usable if brief/stats loading fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionReady, storeId, messages.length]);

  // Predicted next actions for the rotating chip under chat.
  useEffect(() => {
    if (!sessionReady || isLoading) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const chatMsgs = messages
          .filter((m) => !m.addProductForm && !m.photoChoice && (m.text || '').trim())
          .map((m) => ({ text: m.text, isUser: m.isUser }));
        const res = await fetchAiChatSuggestions(storeId, chatMsgs);
        if (cancelled) return;
        const rows = (res?.suggestions || []).filter(
          (s) => s?.label && s?.message,
        ) as ChatSuggestion[];
        if (rows.length) setNextSuggestions(rows);
        else if (!chatMsgs.length) setNextSuggestions(DAY_START_FALLBACK);
      })();
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Refetch after turns settle — not on every mid-turn patch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionReady, storeId, isLoading, messages.length, messages[messages.length - 1]?.id]);

  const send = async (overrideText?: string) => {
    const text = (overrideText ?? inputText).trim();
    if ((!text && !pendingImage) || isLoading || !sessionReady) return;
    if (pendingImage && photoUserMsgId && !text) return;

    // Photo alone (or photo + "add") → field-tile form with photo prefilled.
    if (pendingImage && !photoUserMsgId) {
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

    const existingPhotoMsgId = photoUserMsgId;
    const display =
      text || (existingPhotoMsgId ? '' : 'Please help me list this product from the photo.');
    if (!display) return;

    const imageUri = pendingImage?.uri;
    const imageB64 = pendingImage?.base64;

    if (existingPhotoMsgId) {
      setMessages((prev) =>
        prev
          .filter((msg) => !msg.photoChoice)
          .map((msg) =>
            msg.id === existingPhotoMsgId ? { ...msg, text: display } : msg,
          ),
      );
    } else {
      const userMsg: SellerMsg = {
        id: Date.now().toString(),
        text: display,
        isUser: true,
        timestamp: new Date().toISOString(),
        imageUri,
      };
      setMessages((prev) => [...prev, userMsg]);
    }
    setInputText('');
    setPendingImage(null);
    setPhotoUserMsgId(null);
    setIsLoading(true);

    const hasOpenForm = messages.some((m) => m.addProductForm && !m.addProductSummary);
    let listingContext = listingDraftRef.current?.in_progress
      ? { ...listingDraftRef.current, sku: listingDraftRef.current.sku }
      : undefined;
    if (!listingContext && hasOpenForm) {
      const draft = await loadFormDraft(storeId);
      if (draft && (draft.name || draft.price || draft.photoUri)) {
        listingContext = {
          in_progress: true,
          name: draft.name,
          price: draft.price,
          quantity: draft.quantity,
          category: draft.category,
          description: draft.description,
          hasPhoto: !!draft.photoUri,
          source: 'form',
        };
      } else if (hasOpenForm) {
        listingContext = { in_progress: true, source: 'form' };
      }
    }

    try {
      const response = await apiService.sendMessage(display, sessionId, {
        store: categoryTag(category),
        storeId,
        role: 'seller',
        imageBase64: imageB64,
        listingContext,
      });
      const nextSession = response.session_id || sessionId;
      if (response.session_id) {
        setSessionId(response.session_id);
        await saveStoredSessionId(response.session_id, sessionKey);
      }
      if (response.listing_meta) {
        listingDraftRef.current = {
          ...listingDraftRef.current,
          ...response.listing_meta,
          in_progress: response.listing_meta.in_progress !== false,
        };
      } else if (response.tiles?.length && !listingDraftRef.current?.in_progress) {
        listingDraftRef.current = {};
      }
      const formSync = response.listing_meta
        ? {
            name: response.listing_meta.name,
            price: response.listing_meta.price,
            quantity: response.listing_meta.quantity,
            category: response.listing_meta.category,
            description: response.listing_meta.description,
            sku: response.listing_meta.sku,
          }
        : undefined;
      setMessages((prev) => {
        let next: SellerMsg[] = [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            text: response.displayText || response.answer || '',
            isUser: false,
            timestamp: new Date().toISOString(),
            tiles: response.tiles?.length ? response.tiles : undefined,
          },
        ];
        if (formSync && (formSync.name || formSync.price || formSync.quantity || formSync.sku)) {
          next = pinListingFormToBottom(next, formSync);
        }
        void persistLocal(storeId, nextSession, next);
        return next;
      });
      if (formSync) {
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
      }
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
        void pickImage(true, { directList: true });
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
    setPhotoUserMsgId(null);
    setNextSuggestions(DAY_START_FALLBACK);
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.assistHint}>Ask or automate — stock stays on Stock</Text>
        <View style={styles.topBarActions}>
          {sessionReady ? (
            <SellerAiBriefFab
              mode="header"
              storeId={storeId}
              stats={{
                lowStock: brief.lowStock,
                drafts: brief.drafts,
                queries: brief.queries,
                movers,
              }}
              narrative={aiNarrative}
              priorities={aiPriorities}
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
          ) : null}
          <TouchableOpacity
            style={styles.iconGhost}
            onPress={newChat}
            hitSlop={8}
            accessibilityLabel="New chat"
          >
            <Ionicons name="create-outline" size={18} color={SellerTheme.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {sessionReady && messages.length === 0 ? (
        <View style={styles.emptyBody}>
          <View style={styles.starterHeader}>
            <Text style={styles.starterTitle}>Quick jobs</Text>
            <Text style={styles.starterSub}>Or type below — one job at a time.</Text>
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
                    <Ionicons name={s.icon} size={16} color={Glass.tint.blue} />
                  </View>
                  <Text style={styles.starterText}>{s.label}</Text>
                  <Ionicons name="arrow-forward" size={15} color={SellerTheme.textSecondary} />
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
            {!m.isUser && m.photoChoice ? (
              <View style={[styles.bubble, styles.botBubble, styles.botAlign]}>
                <Text style={styles.bubbleText}>{m.text}</Text>
                {!m.photoChoiceResolved ? (
                  <View style={styles.photoChoiceBtns}>
                    <TouchableOpacity
                      style={styles.photoChoiceBtn}
                      onPress={() =>
                        handlePhotoChoiceQuery(m.formPhoto!, m.id, m.photoChoiceUserMsgId!)
                      }
                      disabled={isLoading}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="chatbubble-ellipses-outline" size={16} color={SellerTheme.text} />
                      <Text style={styles.photoChoiceBtnText}>Query</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.photoChoiceBtn, styles.photoChoiceBtnPrimary]}
                      onPress={() =>
                        handlePhotoChoiceList(m.formPhoto!, m.id, m.photoChoiceUserMsgId!)
                      }
                      disabled={isLoading}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="pricetag-outline" size={16} color="#fff" />
                      <Text style={[styles.photoChoiceBtnText, styles.photoChoiceBtnTextPrimary]}>
                        List product
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            ) : m.text || m.imageUri ? (
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
                    const isPick =
                      t.pick === true ||
                      String(t.tag || '').toUpperCase() === 'TAP TO PICK' ||
                      m.tiles!.some(
                        (x) =>
                          x.pick === true ||
                          String(x.tag || '').toUpperCase() === 'TAP TO PICK',
                      );
                    if (isPick) {
                      const sku = String(t.sku || t.id || '').trim();
                      void send(
                        `Use SKU ${sku} (${t.name}) — apply my last change to this item only.`,
                      );
                      return;
                    }
                    setSelectedTile(t);
                  }}
                />
                {!m.tiles.some(
                  (t) =>
                    t.pick === true || String(t.tag || '').toUpperCase() === 'TAP TO PICK',
                ) ? (
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
                ) : null}
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
                onDraftChange={handleListingDraftChange}
                chatSync={m.chatFormSync || null}
                initialDraftSku={m.formDraftSku || ''}
                onListed={async (item, summary, meta) => {
                  successHaptic();
                  listingDraftRef.current = {};
                  await apiService.clearListingDraft(sessionId);
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
          <Text style={styles.previewLabel}>
            {photoUserMsgId ? 'Photo attached — type your question' : 'Photo ready to send'}
          </Text>
          <TouchableOpacity
            onPress={() => {
              setPendingImage(null);
              setPhotoUserMsgId(null);
            }}
          >
            <Ionicons name="close-circle" size={22} color={Glass.tint.red} />
          </TouchableOpacity>
        </View>
      ) : null}

      <SellerNextSuggestion
        suggestions={nextSuggestions}
        disabled={isLoading || !sessionReady}
        onSelect={(s) => {
          tapHaptic();
          void send(s.message);
        }}
      />

      <GlassPane
        scheme="light"
        intensity="regular"
        radius={Glass.radius.xl}
        style={[
          styles.inputPane,
          {
            paddingBottom: keyboardHeight > 0 ? 8 : Math.max(insets.bottom, 8),
          },
        ]}
        contentStyle={styles.inputRow}
      >
        <TouchableOpacity style={styles.iconBtn} onPress={() => void pickImage(true)}>
          <Ionicons name="camera-outline" size={22} color={SellerTheme.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={() => void pickImage(false)}>
          <Ionicons name="image-outline" size={22} color={SellerTheme.text} />
        </TouchableOpacity>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder={
            photoUserMsgId
              ? 'Ask about this photo…'
              : 'List a product, update price…'
          }
          placeholderTextColor={SellerTheme.textSecondary}
          multiline
          onFocus={() => {
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
          }}
        />
        <TouchableOpacity style={styles.sendBtn} onPress={() => send()} disabled={isLoading}>
          <Ionicons name="arrow-up" size={20} color="#fff" />
        </TouchableOpacity>
      </GlassPane>
      {Platform.OS === 'ios' && keyboardHeight > 0 ? (
        <View style={{ height: keyboardHeight }} />
      ) : null}

      <SellerTileDetailModal
        product={selectedTile}
        storeId={storeId}
        storeName={storeName}
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
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 14,
    marginTop: 6,
    marginBottom: 2,
    gap: 10,
  },
  assistHint: {
    flex: 1,
    fontSize: 12,
    color: SellerTheme.textSecondary,
    fontWeight: '600',
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconGhost: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: SellerTheme.chipIdle,
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
    color: SellerTheme.text,
  },
  starterSub: { fontSize: 12.5, color: SellerTheme.textSecondary },
  starterList: { gap: 8 },
  starterTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: Glass.fill.light,
    borderWidth: 1,
    borderColor: Glass.stroke.lightOuter,
    borderRadius: Glass.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  starterIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(61,123,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  starterText: { flex: 1, fontSize: 14, fontWeight: '600', color: SellerTheme.text },
  typingBubble: { paddingVertical: 14, paddingHorizontal: 16 },
  msgRow: { marginBottom: 8 },
  bubble: {
    maxWidth: '85%',
    borderRadius: Glass.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  botAlign: { alignSelf: 'flex-start' },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(61,123,255,0.90)',
    borderBottomRightRadius: 4,
  },
  botBubble: {
    alignSelf: 'flex-start',
    backgroundColor: Glass.fill.lightStrong,
    borderWidth: 1,
    borderColor: Glass.stroke.lightOuter,
    borderBottomLeftRadius: 4,
  },
  bubbleImage: {
    width: 180,
    height: 180,
    borderRadius: Glass.radius.sm,
    marginBottom: 8,
    backgroundColor: 'rgba(24,30,54,0.08)',
  },
  bubbleText: { fontSize: 15, color: SellerTheme.text, lineHeight: 21 },
  userText: { color: '#fff' },
  typing: { color: SellerTheme.textSecondary, fontStyle: 'italic', marginLeft: 8 },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Glass.fill.lightStrong,
  },
  preview: { width: 56, height: 56, borderRadius: Glass.radius.sm },
  previewLabel: { flex: 1, fontSize: 13, color: SellerTheme.textSecondary },
  bulkRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  bulkChip: {
    backgroundColor: 'rgba(61,123,255,0.90)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  bulkChipText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  photoChoiceBtns: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  photoChoiceBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: Glass.radius.pill,
    backgroundColor: SellerTheme.chipIdle,
  },
  photoChoiceBtnPrimary: {
    backgroundColor: 'rgba(61,123,255,0.90)',
  },
  photoChoiceBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: SellerTheme.text,
  },
  photoChoiceBtnTextPrimary: {
    color: '#fff',
  },
  inputPane: {
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 100,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 8 : 6,
    backgroundColor: 'rgba(24,30,54,0.06)',
    borderRadius: Glass.radius.md,
    fontSize: 15,
    color: SellerTheme.text,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(61,123,255,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
});
