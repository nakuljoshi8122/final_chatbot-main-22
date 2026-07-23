import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/shared/ui/ThemedText';
import { GlassScreen, GlassPane } from '@/shared/ui/Glass';
import { Glass } from '@/shared/theme/LiquidGlass';
import { useApp } from '@/contexts/AppContext';

const CATS = [
  {
    key: 'Skincare',
    label: 'Skincare',
    tag: 'skincare',
    accent: Glass.tint.teal,
    icon: 'water-outline' as const,
  },
  {
    key: 'Apparel',
    label: 'Apparels',
    tag: 'apparels',
    accent: Glass.tint.blue,
    icon: 'shirt-outline' as const,
  },
  {
    key: 'Handicrafts',
    label: 'Handicrafts',
    tag: 'handicrafts',
    accent: Glass.tint.pink,
    icon: 'color-palette-outline' as const,
  },
];

export default function BuyerCategoriesScreen() {
  const router = useRouter();
  const { setRole } = useApp();

  return (
    <GlassScreen scheme="light">
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <GlassPane
        scheme="light"
        intensity="regular"
        radius={Glass.radius.lg}
        style={styles.headerPane}
        contentStyle={styles.header}
      >
        <TouchableOpacity
          onPress={async () => {
            await setRole(null);
            router.replace('/');
          }}
          hitSlop={10}
        >
          <Ionicons name="arrow-back" size={22} color={Glass.ink.light} />
        </TouchableOpacity>
        <ThemedText style={styles.title}>Shop by category</ThemedText>
        <View style={{ width: 22 }} />
      </GlassPane>

      <View style={styles.body}>
        <ThemedText style={styles.subtitle}>
          Choose a category to see shops that sell those products.
        </ThemedText>
        {CATS.map((c) => (
          <TouchableOpacity
            key={c.key}
            style={styles.card}
            onPress={() => router.push(`/buyer/${c.key}`)}
            activeOpacity={0.85}
          >
            <GlassPane
              scheme="light"
              intensity="regular"
              radius={Glass.radius.lg}
              noBlur
              contentStyle={styles.cardContent}
            >
            <View style={[styles.icon, { backgroundColor: c.accent }]}>
              <Ionicons name={c.icon} size={24} color="#fff" />
            </View>
            <ThemedText style={styles.cardTitle}>{c.label}</ThemedText>
            <Ionicons name="chevron-forward" size={18} color={Glass.ink.lightTertiary} />
            </GlassPane>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  headerPane: {
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { fontSize: 17, fontWeight: '700', color: Glass.ink.light },
  body: { padding: 16 },
  subtitle: {
    fontSize: 14,
    color: Glass.ink.lightSecondary,
    marginBottom: 18,
    lineHeight: 20,
  },
  card: { marginBottom: 12 },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: Glass.ink.light },
});
