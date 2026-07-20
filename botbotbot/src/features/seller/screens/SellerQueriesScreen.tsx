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

export default function SellerQueriesScreen() {
  const { storeId } = useLocalSearchParams<{ storeId: string }>();
  const [queries, setQueries] = useState<StoreQuery[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [replies, setReplies] = useState<string[]>([]);
  const [editingPins, setEditingPins] = useState(false);
  const [pinDraft, setPinDraft] = useState('');
  const [toast, setToast] = useState<{
    message: string;
    undo?: () => void;
  } | null>(null);
  const keyboardHeight = useKeyboardHeight();

  const load = useCallback(async () => {
    const [rows, pins] = await Promise.all([
      fetchStoreQueries(String(storeId), 'open'),
      loadPinnedReplies(String(storeId)),
    ]);
    setQueries(rows);
    setReplies(pins);
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
        <ThemedText style={styles.hint}>Tap a chip — sends instantly.</ThemedText>
        <TouchableOpacity onPress={() => setEditingPins((v) => !v)}>
          <Text style={styles.pinEdit}>{editingPins ? 'Done' : 'Edit chips'}</Text>
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
                <Ionicons name="close-circle" size={18} color="#B00020" />
              </TouchableOpacity>
            </View>
          ))}
          <View style={styles.pinAddRow}>
            <TextInput
              style={styles.pinInput}
              value={pinDraft}
              onChangeText={setPinDraft}
              placeholder="New quick reply…"
              placeholderTextColor="#999"
            />
            <TouchableOpacity style={styles.pinAddBtn} onPress={() => void addPin()}>
              <Text style={styles.pinAddText}>Pin</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 30 }} color="#111" />
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
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="checkmark-circle-outline" size={40} color="#1B7F4E" />
              <ThemedText style={styles.empty}>No open questions — nice.</ThemedText>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <ThemedText style={styles.q}>{item.question}</ThemedText>
              {item.notes ? (
                <ThemedText style={styles.notes}>{item.notes}</ThemedText>
              ) : null}
              <View style={styles.chipRow}>
                {replies.map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={styles.replyChip}
                    onPress={() => instantReply(item, r)}
                  >
                    <ThemedText style={styles.replyChipText}>{r}</ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={styles.input}
                placeholder="Or type your own…"
                value={drafts[item.id] || ''}
                onChangeText={(t) => setDrafts((p) => ({ ...p, [item.id]: t }))}
                multiline
              />
              <TouchableOpacity style={styles.btn} onPress={() => void submit(item)}>
                <ThemedText style={styles.btnText}>Send</ThemedText>
              </TouchableOpacity>
            </View>
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
  container: { flex: 1, backgroundColor: '#F4F4F2' },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  hint: { fontSize: 13, color: '#666', flex: 1 },
  pinEdit: { color: '#1D3557', fontWeight: '800', fontSize: 13 },
  pinEditor: {
    marginHorizontal: 16,
    marginTop: 8,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E6E6E6',
    gap: 8,
  },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  pinText: { flex: 1, fontSize: 13, color: '#333', fontWeight: '600' },
  pinAddRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  pinInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#111',
  },
  pinAddBtn: {
    backgroundColor: '#1D3557',
    borderRadius: 8,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  pinAddText: { color: '#fff', fontWeight: '800' },
  emptyWrap: { alignItems: 'center', marginTop: 48, gap: 8 },
  empty: { textAlign: 'center', color: '#888', fontStyle: 'italic' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E6E6E6',
    marginBottom: 12,
  },
  q: { fontSize: 15, fontWeight: '700', color: '#111', marginBottom: 6 },
  notes: { fontSize: 13, color: '#777', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 8,
    padding: 10,
    minHeight: 52,
    textAlignVertical: 'top',
    marginBottom: 8,
    color: '#111',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  replyChip: {
    backgroundColor: '#EEF2F7',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  replyChipText: { fontSize: 12, fontWeight: '700', color: '#1D3557' },
  btn: {
    backgroundColor: '#1D3557',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700' },
});
