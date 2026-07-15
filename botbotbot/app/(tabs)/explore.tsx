import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ServicesShowcase from '@/components/ServicesShowcase';
import { ThemedText } from '@/components/ThemedText';
import { Brand } from '@/constants/Brand';
import { useScreenInsets } from '@/hooks/useScreenInsets';

export default function ExploreScreen() {
  const { contentBottomPadding } = useScreenInsets();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <ThemedText type="title" style={styles.headerTitle}>
          Shop Adidas
        </ThemedText>
        <ThemedText style={styles.headerSubtitle}>
          Footwear, apparel & sports equipment
        </ThemedText>
      </View>
      <ServicesShowcase bottomPadding={contentBottomPadding} />
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
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 14,
    color: Brand.colors.muted,
  },
});
