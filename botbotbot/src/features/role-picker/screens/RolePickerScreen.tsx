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
import { GlassPane, GlassScreen } from '@/shared/ui/Glass';
import { Glass } from '@/shared/theme/LiquidGlass';

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
      <GlassScreen scheme="light">
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={Glass.ink.light} />
        </View>
      </GlassScreen>
    );
  }

  return (
    <GlassScreen scheme="light">
      <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.hero}>
          <ThemedText style={styles.kicker}>ShopAssist POC</ThemedText>
          <ThemedText style={styles.title}>How are you using the app?</ThemedText>
          <ThemedText style={styles.subtitle}>
            Sellers manage shops and inventory. Buyers browse shops by category.
          </ThemedText>
        </View>

        <TouchableOpacity onPress={() => pick('seller')} activeOpacity={0.85}>
          <GlassPane scheme="light" intensity="regular" radius={Glass.radius.lg} style={styles.card} contentStyle={styles.cardContent}>
            <View style={[styles.icon, styles.sellerIcon]}>
              <Ionicons name="storefront-outline" size={28} color={Glass.tint.blue} />
            </View>
            <View style={styles.cardText}>
              <ThemedText style={styles.cardTitle}>Seller</ThemedText>
              <ThemedText style={styles.cardDesc}>
                Open or create stores, list products, manage inventory with chat
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Glass.ink.lightSecondary} />
          </GlassPane>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => pick('buyer')} activeOpacity={0.85}>
          <GlassPane scheme="light" intensity="regular" radius={Glass.radius.lg} style={styles.card} contentStyle={styles.cardContent}>
            <View style={[styles.icon, styles.buyerIcon]}>
              <Ionicons name="bag-handle-outline" size={28} color={Glass.tint.teal} />
            </View>
            <View style={styles.cardText}>
              <ThemedText style={styles.cardTitle}>Buyer</ThemedText>
              <ThemedText style={styles.cardDesc}>
                Pick a category, choose a shop, and chat with that shop&apos;s assistant
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Glass.ink.lightSecondary} />
          </GlassPane>
        </TouchableOpacity>
      </SafeAreaView>
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
  },
  hero: {
    marginTop: 64,
    marginBottom: 36,
  },
  kicker: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: Glass.tint.blue,
    marginBottom: 10,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: Glass.ink.light,
    lineHeight: 38,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: Glass.ink.lightSecondary,
    lineHeight: 22,
  },
  card: {
    marginBottom: 14,
    ...Glass.shadowSoft,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    gap: 14,
  },
  icon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellerIcon: { backgroundColor: 'rgba(61,123,255,0.14)' },
  buyerIcon: { backgroundColor: 'rgba(43,184,168,0.14)' },
  cardText: { flex: 1 },
  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Glass.ink.light,
    marginBottom: 4,
  },
  cardDesc: {
    fontSize: 13,
    color: Glass.ink.lightSecondary,
    lineHeight: 18,
  },
});
