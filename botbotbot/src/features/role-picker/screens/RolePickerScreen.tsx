import React from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/shared/ui/ThemedText';
import { useApp, AppRole } from '@/contexts/AppContext';

export default function RolePickerScreen() {
  const router = useRouter();
  const { ready, setRole } = useApp();

  const pick = async (role: AppRole) => {
    await setRole(role);
    if (role === 'seller') router.replace('/seller');
    else router.replace('/buyer');
  };

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#111" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.hero}>
        <ThemedText style={styles.kicker}>ShopAssist POC</ThemedText>
        <ThemedText style={styles.title}>How are you using the app?</ThemedText>
        <ThemedText style={styles.subtitle}>
          Sellers manage shops and inventory. Buyers browse shops by category.
        </ThemedText>
      </View>

      <TouchableOpacity style={styles.card} onPress={() => pick('seller')} activeOpacity={0.85}>
        <View style={[styles.icon, { backgroundColor: '#1D3557' }]}>
          <Ionicons name="storefront-outline" size={28} color="#fff" />
        </View>
        <View style={styles.cardText}>
          <ThemedText style={styles.cardTitle}>Seller</ThemedText>
          <ThemedText style={styles.cardDesc}>
            Open or create stores, list products, manage inventory with chat
          </ThemedText>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#888" />
      </TouchableOpacity>

      <TouchableOpacity style={styles.card} onPress={() => pick('buyer')} activeOpacity={0.85}>
        <View style={[styles.icon, { backgroundColor: '#2D6A4F' }]}>
          <Ionicons name="bag-handle-outline" size={28} color="#fff" />
        </View>
        <View style={styles.cardText}>
          <ThemedText style={styles.cardTitle}>Buyer</ThemedText>
          <ThemedText style={styles.cardDesc}>
            Pick a category, choose a shop, and chat with that shop&apos;s assistant
          </ThemedText>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#888" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4F4F2',
  },
  container: {
    flex: 1,
    backgroundColor: '#F4F4F2',
    paddingHorizontal: 20,
  },
  hero: {
    marginTop: 56,
    marginBottom: 32,
  },
  kicker: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: '#6B6B6B',
    marginBottom: 10,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#111',
    lineHeight: 38,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#555',
    lineHeight: 22,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E6E6E6',
    marginBottom: 14,
    gap: 14,
  },
  icon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1 },
  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111',
    marginBottom: 4,
  },
  cardDesc: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
  },
});
