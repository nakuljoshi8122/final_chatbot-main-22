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
} from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ThemedText } from '@/shared/ui/ThemedText';
import {
  answerStoreQuery,
  fetchStoreQueries,
  StoreQuery,
} from '@/services/storesApi';

export default function SellerQueriesScreen() {
  const { storeId } = useLocalSearchParams<{ storeId: string }>();
  const [queries, setQueries] = useState<StoreQuery[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const rows = await fetchStoreQueries(String(storeId), 'open');
    setQueries(rows);
    setLoading(false);
  }, [storeId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const submit = async (q: StoreQuery) => {
    const answer = (drafts[q.id] || '').trim();
    if (!answer) {
      Alert.alert('Answer required', 'Type a reply for the buyer question.');
      return;
    }
    const ok = await answerStoreQuery(String(storeId), q.id, answer);
    if (ok) {
      setQueries((prev) => prev.filter((x) => x.id !== q.id));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[q.id];
        return next;
      });
    } else {
      Alert.alert('Error', 'Could not save answer.');
    }
  };

  return (
    <View style={styles.container}>
      <ThemedText style={styles.hint}>
        Unanswered buyer questions for this shop. Reply here so you can follow up.
      </ThemedText>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 30 }} color="#111" />
      ) : (
        <FlatList
          data={queries}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
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
            <ThemedText style={styles.empty}>No open buyer queries.</ThemedText>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <ThemedText style={styles.q}>{item.question}</ThemedText>
              {item.notes ? (
                <ThemedText style={styles.notes}>{item.notes}</ThemedText>
              ) : null}
              <TextInput
                style={styles.input}
                placeholder="Your answer for the buyer…"
                value={drafts[item.id] || ''}
                onChangeText={(t) => setDrafts((p) => ({ ...p, [item.id]: t }))}
                multiline
              />
              <TouchableOpacity style={styles.btn} onPress={() => submit(item)}>
                <ThemedText style={styles.btnText}>Save answer</ThemedText>
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F4F2' },
  hint: {
    paddingHorizontal: 16,
    paddingTop: 12,
    fontSize: 13,
    color: '#666',
  },
  empty: { textAlign: 'center', color: '#888', marginTop: 40, fontStyle: 'italic' },
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
    minHeight: 64,
    textAlignVertical: 'top',
    marginBottom: 10,
    color: '#111',
  },
  btn: {
    backgroundColor: '#1D3557',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700' },
});
