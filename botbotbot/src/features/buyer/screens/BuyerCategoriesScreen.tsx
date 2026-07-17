import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/shared/ui/ThemedText';
import { useApp } from '@/contexts/AppContext';

const CATS = [
  {
    key: 'Skincare',
    label: 'Skincare',
    tag: 'skincare',
    accent: '#2D6A4F',
    icon: 'water-outline' as const,
  },
  {
    key: 'Apparel',
    label: 'Apparels',
    tag: 'apparels',
    accent: '#1D3557',
    icon: 'shirt-outline' as const,
  },
  {
    key: 'Handicrafts',
    label: 'Handicrafts',
    tag: 'handicrafts',
    accent: '#9C6644',
    icon: 'color-palette-outline' as const,
  },
];

export default function BuyerCategoriesScreen() {
  const router = useRouter();
  const { setRole } = useApp();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={async () => {
            await setRole(null);
            router.replace('/');
          }}
          hitSlop={10}
        >
          <Ionicons name="arrow-back" size={22} color="#111" />
        </TouchableOpacity>
        <ThemedText style={styles.title}>Shop by category</ThemedText>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.body}>
        <ThemedText style={styles.subtitle}>
          Choose a category to see shops that sell those products.
        </ThemedText>
        {CATS.map((c) => (
          <TouchableOpacity
            key={c.key}
            style={[styles.card, { borderLeftColor: c.accent }]}
            onPress={() => router.push(`/buyer/${c.key}`)}
            activeOpacity={0.85}
          >
            <View style={[styles.icon, { backgroundColor: c.accent }]}>
              <Ionicons name={c.icon} size={24} color="#fff" />
            </View>
            <ThemedText style={styles.cardTitle}>{c.label}</ThemedText>
            <Ionicons name="chevron-forward" size={18} color="#888" />
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F4F2' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E6E6E6',
  },
  title: { fontSize: 17, fontWeight: '700', color: '#111' },
  body: { padding: 16 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 18, lineHeight: 20 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E6E6E6',
    borderLeftWidth: 4,
    gap: 12,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: '#111' },
});
