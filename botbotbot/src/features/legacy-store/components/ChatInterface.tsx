import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Linking,
  Pressable,
  Alert,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { apiService, ChatMessage } from '@/services/api-fetch';
import type { TileProduct } from '@/shared/utils/parseTiles';
import {
  clearStoredSessionId,
  loadStoredSessionId,
  saveStoredSessionId,
} from '@/shared/utils/chatSession';
import { parseAgentResponse } from '@/shared/utils/parseTiles';
import { useScreenInsets } from '@/shared/hooks/useScreenInsets';
import { useVoiceRecording } from '@/shared/hooks/useVoiceRecording';
import VoiceMessage from '@/features/chat-shared/components/VoiceMessage';
import { ProductTileGrid } from '@/features/chat-shared/components/ProductTileCard';
import { ChatTableList } from '@/features/legacy-store/components/ChatTableView';
import { pushSellerListingsToChat } from '@/services/inventoryStore';
import { useStore } from '@/features/legacy-store/context/StoreContext';
import { useRouter } from 'expo-router';

interface ChatInterfaceProps {
  initialSessionId?: string;
}

const FONT = 'Inter_400Regular';
const FONT_BOLD = 'Inter_700Bold';

export default function ChatInterface({ initialSessionId }: ChatInterfaceProps) {
  const router = useRouter();
  const { store, clearStore } = useStore();
  const storeId = store?.id ?? null;
  const storeTag = store?.agentTag ?? undefined;
  const brandLabel = store?.label || 'Store';
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState(initialSessionId || apiService.generateSessionId());
  const [sessionReady, setSessionReady] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [apiNotice, setApiNotice] = useState<string | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();
  const { headerPaddingTop, tabBarHeight } = useScreenInsets();
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const {
    isRecording,
    isPaused,
    duration,
    recordingUri,
    error: recordingError,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    resetRecording,
  } = useVoiceRecording();

  useEffect(() => {
    apiService.setStoreTag(storeTag || null);
  }, [storeTag]);

  useEffect(() => {
    apiService.checkHealth().then((health) => {
      if (health.status === 'unreachable') {
        setApiNotice('Backend unreachable. Start the API server.');
      } else if (health.api_configured === false) {
        setApiNotice('API key missing on server — set OPENAI_API_KEY or GOOGLE_API_KEY in adk/.env');
      }
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      setSessionReady(false);
      setMessages([]);
      const storedId = initialSessionId || (await loadStoredSessionId(storeId));
      const activeId = storedId || apiService.generateSessionId();
      setSessionId(activeId);

      const history = await apiService.getSessionHistory(activeId);
      if (cancelled) return;

      if (history?.messages?.length) {
        const restored: ChatMessage[] = history.messages.map((msg, index) => {
          const isUser = msg.role === 'user';
          const raw = msg.content || '';
          if (isUser) {
            return {
              id: `restored-u-${index}`,
              text: raw,
              isUser: true,
              timestamp: msg.ts ? new Date(msg.ts) : new Date(),
            };
          }
          const parsed = parseAgentResponse(raw);
          return {
            id: `restored-a-${index}`,
            text: msg.display || parsed.text,
            isUser: false,
            timestamp: msg.ts ? new Date(msg.ts) : new Date(),
            tiles: parsed.tiles,
            tables: parsed.tables,
          };
        });
        setMessages(restored);
      }

      await saveStoredSessionId(activeId, storeId);
      setSessionReady(true);
      void pushSellerListingsToChat();
    };

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, [storeId, initialSessionId]);

  useEffect(() => {
    if (sessionId) {
      saveStoredSessionId(sessionId, storeId);
    }
  }, [sessionId, storeId]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = () => {
      setKeyboardVisible(true);
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 50);
    };
    const onHide = () => setKeyboardVisible(false);

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, [messages, isLoading]);

  const scrollToBottom = () => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  };

  const handleTileSelect = (product: TileProduct) => {
    if (product.id && !product.id.startsWith('tile-')) {
      apiService.setActiveProduct(sessionId, product.id);
    }
  };

  const startNewChat = () => {
    if (isLoading) return;
    Alert.alert('New chat', 'Start a fresh conversation? Current chat stays saved on the server.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'New chat',
        style: 'destructive',
        onPress: async () => {
          const newId = apiService.generateSessionId();
          await clearStoredSessionId(storeId);
          await saveStoredSessionId(newId, storeId);
          setSessionId(newId);
          setMessages([]);
          setInputText('');
          setIsVoiceMode(false);
          setIsLoading(false);
          try {
            await resetRecording();
          } catch {
            // ignore
          }
          Keyboard.dismiss();
        },
      },
    ]);
  };

  const openCheckout = async (url: string) => {
    if (Platform.OS === 'web') {
      const opener = (globalThis as { open?: (u: string, t?: string) => void }).open;
      opener?.(url, '_blank');
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      Linking.openURL(url);
    }
  };

  const buildBotMessage = (
    response: Awaited<ReturnType<typeof apiService.sendMessage>>,
    extra?: Partial<ChatMessage>,
  ): ChatMessage => ({
    id: (Date.now() + 1).toString(),
    text: response.displayText ?? '',
    isUser: false,
    timestamp: new Date(),
    tiles: response.tiles,
    tables: response.tables,
    tileMeta: response.tile_meta,
    commerceMeta: response.commerce_meta,
    ...extra,
  });

  const inputBottomPadding = keyboardVisible
    ? Math.max(insets.bottom, 8)
    : tabBarHeight + 8;

  const sendQuery = async (query: string) => {
    if (!query.trim() || isLoading || !sessionReady) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      text: query.trim(),
      isUser: true,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const response = await apiService.sendMessage(query.trim(), sessionId, storeTag);
      setMessages((prev) => [...prev, buildBotMessage(response)]);
      setSessionId(response.session_id);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          text: error instanceof Error ? error.message : 'Request failed.',
          isUser: false,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!inputText.trim() || isLoading) return;
    const query = inputText.trim();
    setInputText('');
    await sendQuery(query);
  };

  const handleShowMore = () => {
    sendQuery('show me more options like these');
  };

  const sendVoiceMessage = async (uri?: string) => {
    const audioUri = uri || recordingUri;
    if (!audioUri || isLoading) return;

    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        text: 'Voice message',
        isUser: true,
        timestamp: new Date(),
        isVoiceMessage: true,
        audioUri,
      },
    ]);
    setIsLoading(true);

    try {
      const response = await apiService.sendVoiceMessage(audioUri, sessionId, true, storeTag);
      let botAudioUri: string | undefined;
      if (response.audio_response) {
        try {
          const fileUri = `${FileSystem.cacheDirectory}bot_response_${Date.now()}.mp3`;
          await FileSystem.writeAsStringAsync(fileUri, response.audio_response, {
            encoding: FileSystem.EncodingType.Base64,
          });
          botAudioUri = fileUri;
        } catch {
          // text-only fallback
        }
      }

      setMessages((prev) => [
        ...prev,
        buildBotMessage(response, {
          isVoiceMessage: !!botAudioUri,
          audioUri: botAudioUri,
          transcribedText: response.transcribed_text,
        }),
      ]);
      setSessionId(response.session_id);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          text: error instanceof Error ? error.message : 'Voice request failed.',
          isUser: false,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
      await resetRecording();
    }
  };

  const lastTileMessageId = [...messages]
    .reverse()
    .find((m) => !m.isUser && m.tiles && m.tiles.length > 0)?.id;

  const renderAgentContent = (message: ChatMessage) => (
    <View style={styles.agentBlock}>
      {message.text ? <Text style={styles.agentText}>{message.text}</Text> : null}
      {message.tables && message.tables.length > 0 && (
        <ChatTableList tables={message.tables} />
      )}
      {message.commerceMeta?.show_checkout && message.commerceMeta.checkout_url ? (
        <Pressable
          onPress={() => openCheckout(message.commerceMeta!.checkout_url!)}
          style={({ pressed }) => [styles.checkoutBtn, pressed && styles.checkoutBtnPressed]}
        >
          <Text style={styles.checkoutBtnText}>Proceed to checkout</Text>
        </Pressable>
      ) : null}
      {message.tiles && message.tiles.length > 0 && (
        <ProductTileGrid
          tiles={message.tiles}
          showMore={Boolean(message.tileMeta?.has_more && message.id === lastTileMessageId)}
          onShowMore={handleShowMore}
          onTileSelect={handleTileSelect}
        />
      )}
    </View>
  );

  const renderMessage = (message: ChatMessage) => {
    if (message.isVoiceMessage && message.audioUri) {
      return (
        <View key={message.id} style={styles.msgRow}>
          <VoiceMessage
            isUser={message.isUser}
            audioUri={message.audioUri}
            transcribedText={message.transcribedText}
            timestamp={message.timestamp}
          />
          {!message.isUser && (message.tiles?.length || message.tables?.length || message.text)
            ? renderAgentContent(message)
            : null}
        </View>
      );
    }

    if (message.isUser) {
      return (
        <View key={message.id} style={styles.userRow}>
          <View style={styles.userPill}>
            <Text style={styles.userText}>{message.text}</Text>
          </View>
        </View>
      );
    }

    return (
      <View key={message.id} style={styles.agentRow}>
        {renderAgentContent(message)}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      <View style={[styles.topBar, { paddingTop: headerPaddingTop }]}>
        <TouchableOpacity
          onPress={async () => {
            await clearStore();
            router.replace('/');
          }}
          hitSlop={8}
          accessibilityLabel="Switch store"
        >
          <Text style={styles.logo}>{brandLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={startNewChat}
          style={styles.newChatBtn}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Start new chat"
          disabled={isLoading}
        >
          <Ionicons name="create-outline" size={20} color="#000000" />
          <Text style={styles.newChatText}>New</Text>
        </TouchableOpacity>
      </View>

      {apiNotice ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{apiNotice}</Text>
        </View>
      ) : null}

      <ScrollView
        ref={scrollViewRef}
        style={styles.messages}
        contentContainerStyle={[
          styles.messagesContent,
          keyboardVisible && { paddingBottom: 8 },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        {messages.length === 0 && (
          <Text style={styles.hint}>
            Ask for products — e.g. &quot;men&apos;s running shoes&quot; — tiles appear instantly.
          </Text>
        )}
        {messages.map(renderMessage)}
        {isLoading && (
          <View style={styles.agentRow}>
            <Text style={styles.typing}>...</Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.inputBar, { paddingBottom: inputBottomPadding }]}>
        {isVoiceMode ? (
          <View style={styles.voiceBar}>
            {isRecording ? (
              <>
                <Text style={styles.voiceLabel}>
                  {isPaused ? 'Paused' : 'Recording'} {Math.floor(duration)}s
                </Text>
                <TouchableOpacity onPress={isPaused ? resumeRecording : pauseRecording}>
                  <Ionicons name={isPaused ? 'play' : 'pause'} size={22} color="#000" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={async () => {
                    const uri = await stopRecording();
                    if (uri) await sendVoiceMessage(uri);
                  }}
                >
                  <Ionicons name="stop-circle" size={28} color="#000" />
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity onPress={startRecording} disabled={isLoading}>
                  <Ionicons name="mic" size={24} color="#000" />
                </TouchableOpacity>
                <Text style={styles.voiceLabel}>Tap mic to record</Text>
              </>
            )}
            <TouchableOpacity onPress={() => setIsVoiceMode(false)}>
              <Ionicons name="close" size={20} color="#767676" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.inputRow}>
            <TouchableOpacity onPress={() => setIsVoiceMode(true)} style={styles.iconBtn}>
              <Ionicons name="mic-outline" size={20} color="#000" />
            </TouchableOpacity>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder="Message"
              placeholderTextColor="#767676"
              multiline
              maxLength={500}
              editable={!isLoading}
              onFocus={scrollToBottom}
              returnKeyType="send"
              blurOnSubmit={false}
              onSubmitEditing={sendMessage}
            />
            <TouchableOpacity
              onPress={sendMessage}
              disabled={!inputText.trim() || isLoading}
              style={styles.iconBtn}
            >
              <Ionicons
                name="arrow-up"
                size={20}
                color={inputText.trim() && !isLoading ? '#000' : '#C0C0C0'}
              />
            </TouchableOpacity>
          </View>
        )}
        {recordingError ? (
          <Text style={styles.errorText}>{recordingError}</Text>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  topBar: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logo: {
    fontFamily: FONT_BOLD,
    fontSize: 18,
    color: '#000000',
    textTransform: 'lowercase',
    letterSpacing: -0.5,
  },
  newChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 16,
  },
  newChatText: {
    fontFamily: FONT_BOLD,
    fontSize: 12,
    color: '#000000',
  },
  notice: {
    backgroundColor: '#FFF8E1',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  noticeText: {
    fontFamily: FONT,
    fontSize: 11,
    color: '#5C4A00',
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    flexGrow: 1,
  },
  hint: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#767676',
    lineHeight: 18,
    marginTop: 24,
  },
  userRow: {
    alignItems: 'flex-end',
    marginBottom: 10,
  },
  userPill: {
    backgroundColor: '#000000',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: '82%',
  },
  userText: {
    fontFamily: FONT,
    fontSize: 14,
    lineHeight: 19,
    color: '#FFFFFF',
  },
  agentRow: {
    alignItems: 'flex-start',
    marginBottom: 14,
    width: '100%',
  },
  agentBlock: {
    maxWidth: '100%',
    width: '100%',
  },
  agentText: {
    fontFamily: FONT,
    fontSize: 14,
    lineHeight: 19,
    color: '#000000',
  },
  typing: {
    fontFamily: FONT,
    fontSize: 14,
    color: '#767676',
    letterSpacing: 2,
  },
  msgRow: {
    marginBottom: 10,
  },
  inputBar: {
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingTop: 10,
    zIndex: 10,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 48,
  },
  input: {
    flex: 1,
    fontFamily: FONT,
    fontSize: 15,
    lineHeight: 20,
    color: '#000000',
    maxHeight: 120,
    minHeight: 24,
    paddingVertical: Platform.OS === 'ios' ? 8 : 6,
    paddingHorizontal: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as const } : {}),
  },
  iconBtn: {
    padding: 4,
  },
  voiceBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  voiceLabel: {
    flex: 1,
    fontFamily: FONT,
    fontSize: 13,
    color: '#767676',
  },
  errorText: {
    fontFamily: FONT,
    fontSize: 11,
    color: '#C62828',
    marginTop: 6,
  },
  checkoutBtn: {
    marginTop: 10,
    width: '100%',
    backgroundColor: '#000000',
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 4,
  },
  checkoutBtnPressed: {
    backgroundColor: '#333333',
  },
  checkoutBtnText: {
    fontFamily: FONT_BOLD,
    fontSize: 13,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
});
