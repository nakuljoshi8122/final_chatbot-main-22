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
  Image,
  Alert,
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

type Props = {
  storeId: string;
  storeName: string;
  category: string;
};

type SellerMsg = {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: string;
  imageUri?: string;
};

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

function welcomeMsg(storeName: string): SellerMsg {
  return {
    id: 'welcome',
    text: `Hi! I'm your seller assistant for ${storeName}. Ask me to list items, update prices/stock, or upload a product photo and I'll help fill the listing.`,
    isUser: false,
    timestamp: new Date().toISOString(),
  };
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

export default function SellerChatInterface({ storeId, storeName, category }: Props) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<SellerMsg[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState(apiService.generateSessionId());
  const [sessionReady, setSessionReady] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ uri: string; base64: string } | null>(
    null,
  );
  const scrollRef = useRef<ScrollView>(null);
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
        restored = history.messages.map((msg, index) => ({
          id: `hist-${index}`,
          text: msg.display || msg.content || '',
          isUser: msg.role === 'user',
          timestamp: msg.ts || new Date().toISOString(),
        }));
      }
      if (!restored.length) {
        restored = [welcomeMsg(storeName)];
      }
      setMessages(restored);
      await persistLocal(storeId, id, restored);
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

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to upload product images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
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
    setPendingImage({ uri: asset.uri, base64 });
  };

  const send = async () => {
    const text = inputText.trim();
    if ((!text && !pendingImage) || isLoading || !sessionReady) return;

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

  const newChat = async () => {
    const id = apiService.generateSessionId();
    await clearStoredSessionId(sessionKey);
    await saveStoredSessionId(id, sessionKey);
    setSessionId(id);
    const msgs = [welcomeMsg(storeName)];
    setMessages(msgs);
    await persistLocal(storeId, id, msgs);
    setPendingImage(null);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View style={styles.topHint}>
        <Text style={styles.hintText}>Seller chat · upload photos · manage inventory</Text>
        <TouchableOpacity onPress={newChat} hitSlop={8}>
          <Text style={styles.newText}>New</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={{ padding: 12, paddingBottom: 20 }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.map((m) => (
          <View
            key={m.id}
            style={[styles.bubble, m.isUser ? styles.userBubble : styles.botBubble]}
          >
            {m.imageUri ? (
              <Image source={{ uri: m.imageUri }} style={styles.bubbleImage} />
            ) : null}
            <Text style={[styles.bubbleText, m.isUser && styles.userText]}>{m.text}</Text>
          </View>
        ))}
        {isLoading ? <Text style={styles.typing}>Working…</Text> : null}
      </ScrollView>

      {pendingImage ? (
        <View style={styles.previewRow}>
          <Image source={{ uri: pendingImage.uri }} style={styles.preview} />
          <Text style={styles.previewLabel}>Photo ready to send</Text>
          <TouchableOpacity onPress={() => setPendingImage(null)}>
            <Ionicons name="close-circle" size={22} color="#c00" />
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={[styles.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        <TouchableOpacity style={styles.iconBtn} onPress={pickImage}>
          <Ionicons name="image-outline" size={22} color="#1D3557" />
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="List a product, update price…"
          placeholderTextColor="#999"
          multiline
        />
        <TouchableOpacity style={styles.sendBtn} onPress={send} disabled={isLoading}>
          <Ionicons name="arrow-up" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  topHint: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
  },
  hintText: { fontSize: 12, color: '#666' },
  newText: { fontSize: 13, fontWeight: '700', color: '#1D3557' },
  messages: { flex: 1 },
  bubble: {
    maxWidth: '85%',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
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
