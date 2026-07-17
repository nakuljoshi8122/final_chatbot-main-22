import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
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
import { useApp } from '@/contexts/AppContext';
import { ThemedText } from '@/shared/ui/ThemedText';

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
  const { selectedStore, stores } = useApp();
  const store =
    selectedStore?.id === storeId
      ? selectedStore
      : stores.find((s) => s.id === storeId) || null;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState(apiService.generateSessionId());
  const [sessionReady, setSessionReady] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const sessionKey = `buyer_${storeId}`;

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

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: 12, paddingBottom: 20 }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.map((m) => (
            <View key={m.id} style={{ marginBottom: 10 }}>
              <View style={[styles.bubble, m.isUser ? styles.user : styles.bot]}>
                <Text style={[styles.text, m.isUser && { color: '#fff' }]}>{m.text}</Text>
              </View>
              {!m.isUser && m.tiles?.length ? (
                <ProductTileGrid tiles={m.tiles} />
              ) : null}
            </View>
          ))}
          {isLoading ? <Text style={styles.typing}>Thinking…</Text> : null}
        </ScrollView>

        <View style={[styles.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Ask about this shop's products…"
            placeholderTextColor="#999"
            onSubmitEditing={send}
          />
          <TouchableOpacity style={styles.send} onPress={send}>
            <Ionicons name="arrow-up" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
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
