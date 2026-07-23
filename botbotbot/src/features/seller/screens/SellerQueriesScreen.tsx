import React, { useCallback, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Text,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/shared/ui/ThemedText';
import {
  answerStoreQuery,
  fetchStoreQueries,
  StoreQuery,
} from '@/services/storesApi';
import { useKeyboardHeight } from '@/shared/hooks/useKeyboardHeight';
import {
  loadPinnedReplies,
  savePinnedReplies,
} from '@/services/sellerLazyStore';
import UndoToast from '@/shared/ui/UndoToast';
import { fetchAiQueryDraft, translateReplyText, fetchAiBuyerIntent } from '@/services/sellerAiApi';
import { GlassPane, GlassPill } from '@/shared/ui/Glass';
import { Glass } from '@/shared/theme/LiquidGlass';
import { SellerTheme } from '@/shared/theme/SellerTheme';

const LANG_OPTIONS = ['', 'Hindi', 'Spanish', 'French'];

export default function SellerQueriesScreen() {
  const { storeId } = useLocalSearchParams<{ storeId: string }>();
  const [queries, setQueries] = useState<StoreQuery[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [replies, setReplies] = useState<string[]>([]);
  const [editingPins, setEditingPins] = useState(false);
  const [pinDraft, setPinDraft] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    undo?: () => void;
  } | null>(null);
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [replyLang, setReplyLang] = useState('');
  const [intentTip, setIntentTip] = useState('');
  const keyboardHeight = useKeyboardHeight();

  const load = useCallback(async () => {
    const [rows, pins, intent] = await Promise.all([
      fetchStoreQueries(String(storeId), 'open'),
      loadPinnedReplies(String(storeId)),
      fetchAiBuyerIntent(String(storeId)),
    ]);
    setQueries(rows);
    setReplies(pins);
    if (intent?.tip) setIntentTip(intent.tip);
    setLoading(false);
  }, [storeId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const submit = async (q: StoreQuery, answerOverride?: string) => {
    const answer = (answerOverride ?? drafts[q.id] ?? '').trim();
    if (!answer) {
      Alert.alert('Answer required', 'Pick a chip or type a reply.');
      return;
    }
    const snapshot = q;
    const ok = await answerStoreQuery(String(storeId), q.id, answer);
    if (!ok) {
      Alert.alert('Error', 'Could not save answer.');
      return;
    }
    setQueries((prev) => prev.filter((x) => x.id !== q.id));
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[q.id];
      return next;
    });
    setToast({
      message: 'Reply sent',
      undo: () => {
        // Soft undo: put the question back in the list (answer already saved —
        // full undo would need an API; this restores UI so they can see it again)
        setQueries((prev) => [snapshot, ...prev]);
      },
    });
  };

  const instantReply = (q: StoreQuery, text: string) => {
    void submit(q, text);
  };

  const aiDraftReply = async (q: StoreQuery) => {
    setAiLoading(q.id);
    const out = await fetchAiQueryDraft(
      String(storeId),
      q.question,
      q.notes || '',
      replyLang,
    );
    setAiLoading(null);
    if (out?.draft) {
      setDrafts((prev) => ({ ...prev, [q.id]: out.draft! }));
    } else {
      Alert.alert('AI draft', 'Could not generate a reply — try again or type manually.');
    }
  };

  const translateDraft = async (q: StoreQuery) => {
    const text = (drafts[q.id] || '').trim();
    if (!text || !replyLang) {
      Alert.alert('Translate', 'Pick a language and draft or type a reply first.');
      return;
    }
    setAiLoading(q.id);
    const out = await translateReplyText(text, replyLang);
    setAiLoading(null);
    if (out?.translated) {
      setDrafts((prev) => ({ ...prev, [q.id]: out.translated! }));
    }
  };

  const addPin = async () => {
    const t = pinDraft.trim();
    if (!t) return;
    const next = [...replies.filter((r) => r !== t), t].slice(0, 6);
    setReplies(next);
    setPinDraft('');
    await savePinnedReplies(String(storeId), next);
  };

  const removePin = async (text: string) => {
    const next = replies.filter((r) => r !== text);
    setReplies(next);
    await savePinnedReplies(String(storeId), next);
  };

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <ThemedText style={styles.hint}>
          {queries.length
            ? `${queries.length} open · answer the oldest first`
            : 'Inbox clear'}
        </ThemedText>
        <TouchableOpacity
          onPress={() => setShowSettings((v) => !v)}
          hitSlop={8}
          style={styles.settingsBtn}
        >
          <Ionicons
            name="settings-outline"
            size={18}
            color={showSettings ? Glass.tint.blue : SellerTheme.text}
          />
        </TouchableOpacity>
      </View>

      {showSettings ? (
        <View style={styles.settingsPanel}>
          <View style={styles.langRow}>
            <ThemedText style={styles.langLabel}>Reply language</ThemedText>
            {LANG_OPTIONS.map((lang) => (
              <TouchableOpacity key={lang || 'en'} onPress={() => setReplyLang(lang)}>
                <GlassPill
                  scheme="light"
                  active={replyLang === lang}
                  activeColor={SellerTheme.chipActive}
                  style={styles.langChip}
                >
                  <Text style={[styles.langChipText, replyLang === lang && styles.langChipTextOn]}>
                    {lang || 'English'}
                  </Text>
                </GlassPill>
              </TouchableOpacity>
            ))}
          </View>

          {intentTip ? (
            <View style={styles.intentBox}>
              <Text style={styles.intentText}>{intentTip}</Text>
            </View>
          ) : null}

          <View style={styles.pinHeader}>
            <ThemedText style={styles.langLabel}>Quick replies</ThemedText>
            <TouchableOpacity onPress={() => setEditingPins((v) => !v)}>
              <Text style={styles.pinEdit}>{editingPins ? 'Done' : 'Edit'}</Text>
            </TouchableOpacity>
          </View>

          {editingPins ? (
            <View style={styles.pinEditor}>
              {replies.map((r) => (
                <View key={r} style={styles.pinRow}>
                  <Text style={styles.pinText} numberOfLines={1}>
                    {r}
                  </Text>
                  <TouchableOpacity onPress={() => void removePin(r)}>
                    <Ionicons name="close-circle" size={18} color={Glass.tint.red} />
                  </TouchableOpacity>
                </View>
              ))}
              <View style={styles.pinAddRow}>
                <TextInput
                  style={styles.pinInput}
                  value={pinDraft}
                  onChangeText={setPinDraft}
                  placeholder="New quick reply…"
                  placeholderTextColor={SellerTheme.textSecondary}
                />
                <TouchableOpacity style={styles.pinAddBtn} onPress={() => void addPin()}>
                  <Text style={styles.pinAddText}>Pin</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : replies.length ? (
            <Text style={styles.pinPreview} numberOfLines={1}>
              {replies.join(' · ')}
            </Text>
          ) : (
            <Text style={styles.pinPreview}>No quick replies yet</Text>
          )}
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 30 }} color={Glass.ink.light} />
      ) : (
        <FlatList
          data={queries}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            padding: 16,
            paddingBottom: 40 + (Platform.OS === 'ios' ? keyboardHeight : 0),
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={Glass.ink.lightSecondary}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="checkmark-circle-outline" size={40} color={Glass.tint.green} />
              <ThemedText style={styles.empty}>No open questions — nice.</ThemedText>
            </View>
          }
          renderItem={({ item }) => (
            <GlassPane
              scheme="light"
              intensity="regular"
              noBlur
              flat
              style={styles.card}
              contentStyle={styles.cardContent}
            >
              <ThemedText style={styles.q}>{item.question}</ThemedText>
              {item.notes ? (
                <ThemedText style={styles.notes}>{item.notes}</ThemedText>
              ) : null}
              <View style={styles.chipRow}>
                <TouchableOpacity
                  onPress={() => void aiDraftReply(item)}
                  disabled={aiLoading === item.id}
                >
                  <GlassPill scheme="light" style={styles.aiChip}>
                    {aiLoading === item.id ? (
                      <ActivityIndicator size="small" color={Glass.tint.blue} />
                    ) : (
                      <ThemedText style={styles.aiChipText}>AI draft</ThemedText>
                    )}
                  </GlassPill>
                </TouchableOpacity>
                {replyLang ? (
                  <TouchableOpacity onPress={() => void translateDraft(item)}>
                    <GlassPill scheme="light" style={styles.aiChip}>
                      <ThemedText style={styles.aiChipText}>Translate</ThemedText>
                    </GlassPill>
                  </TouchableOpacity>
                ) : null}
                {replies.map((r) => (
                  <TouchableOpacity key={r} onPress={() => instantReply(item, r)}>
                    <GlassPill scheme="light" style={styles.replyChip}>
                      <ThemedText style={styles.replyChipText}>{r}</ThemedText>
                    </GlassPill>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={styles.input}
                placeholder="Or type your own…"
                placeholderTextColor={SellerTheme.textSecondary}
                value={drafts[item.id] || ''}
                onChangeText={(t) => setDrafts((p) => ({ ...p, [item.id]: t }))}
                multiline
              />
              <TouchableOpacity style={styles.btn} onPress={() => void submit(item)}>
                <ThemedText style={styles.btnText}>Send</ThemedText>
              </TouchableOpacity>
            </GlassPane>
          )}
        />
      )}

      <UndoToast
        message={toast?.message ?? null}
        onUndo={toast?.undo}
        onDismiss={() => setToast(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  hint: { fontSize: 13, color: SellerTheme.textSecondary, flex: 1, fontWeight: '600' },
  settingsBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: SellerTheme.chipIdle,
  },
  settingsPanel: {
    marginHorizontal: 12,
    marginBottom: 4,
    padding: 12,
    borderRadius: Glass.radius.md,
    backgroundColor: Glass.fill.light,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Glass.stroke.lightOuter,
    gap: 8,
  },
  pinHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  pinPreview: {
    fontSize: 12,
    color: SellerTheme.textSecondary,
  },
  pinEdit: { color: Glass.tint.blue, fontWeight: '800', fontSize: 13 },
  langRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  langLabel: { fontSize: 12, color: SellerTheme.textSecondary, marginRight: 4, fontWeight: '700' },
  langChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  langChipText: { fontSize: 11, fontWeight: '700', color: SellerTheme.text },
  langChipTextOn: { color: SellerTheme.chipActiveText },
  aiChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  aiChipText: { fontSize: 12, fontWeight: '800', color: Glass.tint.blue },
  intentBox: {
    padding: 10,
    backgroundColor: 'rgba(61,123,255,0.10)',
    borderRadius: Glass.radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(61,123,255,0.22)',
  },
  intentText: { fontSize: 12, color: Glass.ink.lightSecondary, lineHeight: 17 },
  pinEditor: {
    paddingTop: 4,
    gap: 8,
  },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  pinText: { flex: 1, fontSize: 13, color: SellerTheme.text, fontWeight: '600' },
  pinAddRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  pinInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: Glass.stroke.lightOuter,
    borderRadius: Glass.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: SellerTheme.text,
    backgroundColor: Glass.fill.lightSoft,
  },
  pinAddBtn: {
    backgroundColor: Glass.tint.blue,
    borderRadius: Glass.radius.pill,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  pinAddText: { color: '#fff', fontWeight: '800' },
  emptyWrap: { alignItems: 'center', marginTop: 48, gap: 8 },
  empty: { textAlign: 'center', color: SellerTheme.textSecondary },
  card: {
    borderRadius: Glass.radius.md,
    marginBottom: 12,
  },
  cardContent: {
    padding: 14,
  },
  q: { fontSize: 15, fontWeight: '700', color: SellerTheme.text, marginBottom: 6 },
  notes: { fontSize: 13, color: SellerTheme.textSecondary, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: Glass.stroke.lightOuter,
    borderRadius: Glass.radius.sm,
    padding: 10,
    minHeight: 52,
    textAlignVertical: 'top',
    marginBottom: 8,
    color: SellerTheme.text,
    backgroundColor: Glass.fill.lightSoft,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  replyChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  replyChipText: { fontSize: 12, fontWeight: '700', color: SellerTheme.text },
  btn: {
    backgroundColor: Glass.tint.blue,
    borderRadius: Glass.radius.pill,
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700' },
});
