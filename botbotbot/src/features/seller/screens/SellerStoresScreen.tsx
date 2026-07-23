import React, { useCallback, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/shared/ui/ThemedText';
import { useApp } from '@/contexts/AppContext';
import { deleteStore, ShopStore } from '@/services/storesApi';
import { API_BASE } from '@/services/apiBase';
import { GlassPane, GlassPill, GlassScreen } from '@/shared/ui/Glass';
import { Glass } from '@/shared/theme/LiquidGlass';
import { SellerTheme } from '@/shared/theme/SellerTheme';

export default function SellerStoresScreen() {
  const router = useRouter();
  const { setRole, refreshStores, selectStore, selectedStore } = useApp();
  const [stores, setStores] = useState<ShopStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ShopStore | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const list = await refreshStores();
    setStores(list);
    setLoading(false);
  }, [refreshStores]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openStore = async (store: ShopStore) => {
    await selectStore(store);
    // Land on Assist — chat-first seller home
    router.push(`/seller/${store.id}`);
  };

  const openDeleteModal = (store: ShopStore) => {
    setPendingDelete(store);
    setConfirmName('');
  };

  const closeDeleteModal = () => {
    if (deleting) return;
    setPendingDelete(null);
    setConfirmName('');
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const typed = confirmName.trim();
    if (!typed) {
      Alert.alert('Confirm name', 'Type the store name to delete it.');
      return;
    }
    if (typed.toLowerCase() !== pendingDelete.name.trim().toLowerCase()) {
      Alert.alert(
        'Name mismatch',
        `Type "${pendingDelete.name}" exactly to confirm.`,
      );
      return;
    }
    setDeleting(true);
    try {
      const res = await deleteStore(pendingDelete.id, typed);
      if (!res.ok) {
        Alert.alert('Could not delete', res.error || 'Try again.');
        return;
      }
      if (selectedStore?.id === pendingDelete.id) {
        await selectStore(null);
      }
      setPendingDelete(null);
      setConfirmName('');
      await load();
      Alert.alert(
        'Store deleted',
        `${res.name || pendingDelete.name} and its inventory were removed.`,
      );
    } finally {
      setDeleting(false);
    }
  };

  const nameMatches =
    !!pendingDelete &&
    confirmName.trim().toLowerCase() === pendingDelete.name.trim().toLowerCase();

  return (
    <GlassScreen scheme="light">
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <GlassPane scheme="light" intensity="regular" radius={0} flat>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={async () => {
                await setRole(null);
                router.replace('/');
              }}
              hitSlop={10}
            >
              <Ionicons name="chevron-back" size={22} color={Glass.ink.light} />
            </TouchableOpacity>
            <ThemedText style={styles.title}>Stores</ThemedText>
            <TouchableOpacity onPress={() => router.push('/seller/new')} hitSlop={10}>
              <Ionicons name="add" size={24} color={Glass.tint.blue} />
            </TouchableOpacity>
          </View>
        </GlassPane>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={Glass.ink.light} />
        ) : (
          <FlatList
            data={stores}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
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
                <ThemedText style={styles.empty}>No stores yet.</ThemedText>
                <ThemedText style={styles.emptyHint}>
                  If this looks wrong, the app is calling {API_BASE}
                </ThemedText>
                <TouchableOpacity
                  style={styles.newBtn}
                  onPress={() => router.push('/seller/new')}
                  activeOpacity={0.85}
                >
                  <Ionicons name="add" size={18} color="#fff" />
                  <ThemedText style={styles.newBtnText}>Create store</ThemedText>
                </TouchableOpacity>
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
                <TouchableOpacity onPress={() => openStore(item)} activeOpacity={0.85}>
                  <View style={styles.cardTop}>
                    <ThemedText style={styles.cardName}>{item.name}</ThemedText>
                    <GlassPill scheme="light" style={styles.tag}>
                      <ThemedText style={styles.tagText}>{item.category}</ThemedText>
                    </GlassPill>
                  </View>
                  <ThemedText style={styles.owner}>{item.owner_name}</ThemedText>
                  {item.description ? (
                    <ThemedText style={styles.desc} numberOfLines={2}>
                      {item.description}
                    </ThemedText>
                  ) : null}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => openDeleteModal(item)}
                  hitSlop={8}
                  accessibilityLabel={`Delete ${item.name}`}
                >
                  <Ionicons name="trash-outline" size={16} color="#F87171" />
                  <ThemedText style={styles.deleteBtnText}>Delete store</ThemedText>
                </TouchableOpacity>
              </GlassPane>
            )}
          />
        )}
      </SafeAreaView>

      <Modal
        visible={!!pendingDelete}
        transparent
        animationType="fade"
        onRequestClose={closeDeleteModal}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={closeDeleteModal}
          />
          <View style={styles.modalCard}>
            <ThemedText style={styles.modalTitle}>Delete store?</ThemedText>
            <ThemedText style={styles.modalBody}>
              This permanently removes{' '}
              <ThemedText style={styles.modalStrong}>{pendingDelete?.name}</ThemedText>
              , all of its inventory (starter catalog + anything you added), inbox
              questions, and hides it from buyers. Other stores stay intact.
            </ThemedText>
            <ThemedText style={styles.modalHint}>
              Type the store name to confirm:
            </ThemedText>
            <TextInput
              style={styles.modalInput}
              value={confirmName}
              onChangeText={setConfirmName}
              placeholder={pendingDelete?.name || 'Store name'}
              placeholderTextColor={SellerTheme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!deleting}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={closeDeleteModal}
                disabled={deleting}
              >
                <ThemedText style={styles.modalCancelText}>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalDelete,
                  (!nameMatches || deleting) && styles.modalDeleteDisabled,
                ]}
                onPress={() => void confirmDelete()}
                disabled={!nameMatches || deleting}
              >
                {deleting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <ThemedText style={styles.modalDeleteText}>Delete forever</ThemedText>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { fontSize: 18, fontWeight: '700', color: SellerTheme.text },
  emptyWrap: { alignItems: 'center', marginTop: 56, gap: 16, paddingHorizontal: 24 },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Glass.tint.blue,
    borderRadius: Glass.radius.pill,
    paddingVertical: 12,
    paddingHorizontal: 18,
    ...Glass.shadowSoft,
  },
  newBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  empty: { textAlign: 'center', color: SellerTheme.textSecondary, fontSize: 15 },
  emptyHint: {
    textAlign: 'center',
    color: SellerTheme.textSecondary,
    fontSize: 12,
    marginTop: -8,
  },
  card: {
    marginBottom: 10,
  },
  cardContent: { paddingVertical: 14, paddingHorizontal: 16 },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  cardName: { fontSize: 17, fontWeight: '700', color: SellerTheme.text, flex: 1 },
  tag: {
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  tagText: { color: SellerTheme.textSecondary, fontSize: 11, fontWeight: '700' },
  owner: { fontSize: 13, color: SellerTheme.textSecondary, marginBottom: 2 },
  desc: { fontSize: 13, color: SellerTheme.textSecondary, marginTop: 2 },
  deleteBtn: {
    marginTop: 12,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  deleteBtnText: { color: '#F87171', fontSize: 13, fontWeight: '600' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(122,132,166,0.28)',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: SellerTheme.text,
    marginBottom: 8,
  },
  modalBody: {
    fontSize: 14,
    lineHeight: 20,
    color: SellerTheme.textSecondary,
    marginBottom: 14,
  },
  modalStrong: { fontWeight: '700', color: SellerTheme.text },
  modalHint: {
    fontSize: 13,
    color: SellerTheme.textSecondary,
    marginBottom: 8,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: 'rgba(122,132,166,0.28)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: SellerTheme.text,
    fontSize: 15,
    marginBottom: 16,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  modalActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  modalCancel: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  modalCancelText: { color: SellerTheme.textSecondary, fontWeight: '600' },
  modalDelete: {
    backgroundColor: '#DC2626',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    minWidth: 120,
    alignItems: 'center',
  },
  modalDeleteDisabled: { opacity: 0.4 },
  modalDeleteText: { color: '#fff', fontWeight: '700' },
});
