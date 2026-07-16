import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/ThemedText';
import { Brand } from '@/constants/Brand';
import { useScreenInsets } from '@/hooks/useScreenInsets';
import { useStore } from '@/context/StoreContext';
import {
  fetchShopRequests,
  fulfillShopRequest,
  formatWhen,
  ShopRequest,
} from '@/services/shopRequests';

export default function ProfileScreen() {
  const router = useRouter();
  const { store, clearStore, ready } = useStore();
  const { contentBottomPadding } = useScreenInsets();
  const [requests, setRequests] = useState<ShopRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (ready && !store) {
      router.replace('/');
    }
  }, [ready, store, router]);

  const loadRequests = useCallback(async () => {
    const rows = await fetchShopRequests('open');
    setRequests(rows);
    setLoadingRequests(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadRequests();
    }, [loadRequests])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadRequests();
    setRefreshing(false);
  };

  const handleFulfill = async (id: number) => {
    const ok = await fulfillShopRequest(id);
    if (ok) {
      setRequests((prev) => prev.filter((r) => r.id !== id));
    }
  };

  const handleContact = (type: string, value: string) => {
    switch (type) {
      case 'phone':
        Linking.openURL(`tel:${value}`);
        break;
      case 'email':
        Linking.openURL(`mailto:${value}`);
        break;
      case 'web':
        Linking.openURL(value);
        break;
      default:
        break;
    }
  };

  if (!ready || !store) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color="#111" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <ThemedText type="title" style={styles.headerTitle}>
          {store.label} Store
        </ThemedText>
        <ThemedText style={styles.headerSubtitle}>{store.tagline}</ThemedText>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: contentBottomPadding }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.profileCard}>
          <View style={styles.logoContainer}>
            <ThemedText style={[styles.logoText, { color: store.accent }]}>
              {store.brandName}
            </ThemedText>
          </View>

          <ThemedText type="title" style={styles.name}>
            {store.agentTitle}
          </ThemedText>

          <ThemedText style={styles.profession}>
            Tag: {store.agentTag} · {store.category} catalog only
          </ThemedText>

          <View style={styles.detailsContainer}>
            <View style={styles.detailRow}>
              <Ionicons name="pricetag-outline" size={20} color={Brand.colors.muted} />
              <ThemedText style={styles.detailText}>{store.description}</ThemedText>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.sellerButton, { marginTop: 16, backgroundColor: store.accent }]}
            onPress={async () => {
              await clearStore();
              router.replace('/');
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="swap-horizontal" size={20} color="white" />
            <View style={styles.sellerButtonTextWrap}>
              <ThemedText style={styles.sellerButtonTitle}>Switch store</ThemedText>
              <ThemedText style={styles.sellerButtonSub}>
                Back to Skincare / Handicrafts / Apparels
              </ThemedText>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Customer requests
          </ThemedText>
          <ThemedText style={styles.description}>
            Items shoppers asked for that are not in stock yet. Add them to inventory when you can source them.
          </ThemedText>
          {loadingRequests ? (
            <ActivityIndicator style={styles.requestsLoader} color={Brand.colors.primary} />
          ) : requests.length === 0 ? (
            <ThemedText style={styles.emptyRequests}>No open requests right now.</ThemedText>
          ) : (
            requests.map((req) => (
              <View key={req.id} style={styles.requestCard}>
                <View style={styles.requestMain}>
                  <ThemedText style={styles.requestItem}>{req.item_query}</ThemedText>
                  {req.notes ? (
                    <ThemedText style={styles.requestNotes}>{req.notes}</ThemedText>
                  ) : null}
                  <ThemedText style={styles.requestMeta}>
                    {formatWhen(req.created_at)}
                  </ThemedText>
                </View>
                <TouchableOpacity
                  style={styles.fulfillButton}
                  onPress={() => handleFulfill(req.id)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="checkmark" size={18} color="white" />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Seller
          </ThemedText>
          <TouchableOpacity
            style={styles.sellerButton}
            onPress={() => router.push('/inventory')}
            activeOpacity={0.8}
          >
            <Ionicons name="cube-outline" size={22} color="white" />
            <View style={styles.sellerButtonTextWrap}>
              <ThemedText style={styles.sellerButtonTitle}>Inventory</ThemedText>
              <ThemedText style={styles.sellerButtonSub}>
                Manage {store.category} listings for this store
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.8)" />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Shopping Support
          </ThemedText>
          <ThemedText style={styles.description}>
            The {store.label} assistant only answers from the {store.category} catalog
            (agent tag: {store.agentTag}).
          </ThemedText>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Brand.colors.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Brand.colors.border,
    backgroundColor: Brand.colors.accent,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 4,
    color: Brand.colors.primary,
  },
  headerSubtitle: {
    fontSize: 14,
    color: Brand.colors.muted,
    fontStyle: 'italic',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  profileCard: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Brand.colors.border,
    marginVertical: 16,
    backgroundColor: Brand.colors.accent,
  },
  logoContainer: {
    marginBottom: 16,
  },
  logoText: {
    fontSize: 36,
    fontWeight: '900',
    color: Brand.colors.primary,
    letterSpacing: -1,
    textTransform: 'lowercase',
  },
  name: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
    color: Brand.colors.primary,
  },
  profession: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 20,
    textAlign: 'center',
    color: Brand.colors.muted,
  },
  detailsContainer: {
    width: '100%',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  detailText: {
    fontSize: 15,
    marginLeft: 12,
    flex: 1,
    color: Brand.colors.highlight,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    color: Brand.colors.primary,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: Brand.colors.muted,
  },
  highlightsList: {
    marginTop: 8,
  },
  highlightItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  highlightText: {
    fontSize: 15,
    marginLeft: 12,
    flex: 1,
    lineHeight: 22,
    color: Brand.colors.highlight,
  },
  sellerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Brand.colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 4,
    gap: 12,
  },
  sellerButtonTextWrap: {
    flex: 1,
  },
  sellerButtonTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
  },
  sellerButtonSub: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    marginTop: 2,
  },
  requestsLoader: {
    marginTop: 12,
  },
  emptyRequests: {
    fontSize: 14,
    color: Brand.colors.muted,
    marginTop: 8,
    fontStyle: 'italic',
  },
  requestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Brand.colors.border,
    borderRadius: 4,
    padding: 12,
    marginTop: 10,
    backgroundColor: Brand.colors.accent,
    gap: 10,
  },
  requestMain: {
    flex: 1,
  },
  requestItem: {
    fontSize: 15,
    fontWeight: '600',
    color: Brand.colors.primary,
  },
  requestNotes: {
    fontSize: 13,
    color: Brand.colors.muted,
    marginTop: 4,
  },
  requestMeta: {
    fontSize: 12,
    color: Brand.colors.muted,
    marginTop: 4,
  },
  fulfillButton: {
    backgroundColor: Brand.colors.primary,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 8,
  },
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 0,
    minWidth: 120,
    justifyContent: 'center',
    backgroundColor: Brand.colors.primary,
  },
  contactButtonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 6,
  },
});
