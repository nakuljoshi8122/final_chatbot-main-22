import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Brand } from '@/shared/theme/Brand';
import { GlassScreen, GlassPane } from '@/shared/ui/Glass';
import { Glass } from '@/shared/theme/LiquidGlass';
import { ProductCard } from '@/types/products';
import { apiService } from '@/services/api-fetch';

function parseJsonArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value[0] : value;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function resolveParam(value: string | string[] | undefined): string {
  if (!value) return '';
  return Array.isArray(value) ? value[0] : value;
}

export default function ProductDetailScreen() {
  const router = useRouter();
  const {
    id: rawId,
    name,
    price,
    category,
    description,
    features,
    icon,
    sport,
    audience,
    sizes,
    colors,
  } = useLocalSearchParams<{
    id: string;
    name?: string;
    price?: string;
    category?: string;
    description?: string;
    features?: string;
    icon?: string;
    sport?: string;
    audience?: string;
    sizes?: string;
    colors?: string;
  }>();

  // Primitive string — safe as the only useEffect dependency
  const productId = resolveParam(rawId);

  const [product, setProduct] = useState<ProductCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    if (!productId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fromNav: ProductCard = {
      id: productId,
      name: resolveParam(name) || 'Product',
      price: resolveParam(price),
      category: resolveParam(category),
      description: resolveParam(description),
      features: parseJsonArray(features),
      icon: resolveParam(icon) || 'footsteps',
      sport: resolveParam(sport),
      audience: resolveParam(audience),
      sizes: parseJsonArray(sizes),
      colors: parseJsonArray(colors),
    };

    setProduct(fromNav);
    setLoading(true);

    apiService
      .getProduct(productId)
      .then((fetched) => {
        if (!cancelled && fetched) setProduct(fetched);
      })
      .catch(() => {
        // Keep navigation params as fallback
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [productId]);

  if (!product) {
    return (
      <GlassScreen scheme="light">
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={Brand.colors.primary} style={{ marginTop: 40 }} />
      </SafeAreaView>
      </GlassScreen>
    );
  }

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
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={Glass.ink.light} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Product</Text>
        <View style={styles.headerSpacer} />
      </GlassPane>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {product.img && !imgError ? (
          <Image
            source={{ uri: product.img }}
            style={styles.heroImage}
            contentFit="contain"
            transition={200}
            onError={() => setImgError(true)}
          />
        ) : (
          <View style={styles.heroIcon}>
            <Ionicons name={product.icon as any} size={48} color={Brand.colors.primary} />
          </View>
        )}

        <Text style={styles.category}>{product.category.toUpperCase()}</Text>
        <Text style={styles.name}>{product.name}</Text>
        <Text style={styles.price}>{product.price}</Text>

        {loading && (
          <ActivityIndicator size="small" color={Brand.colors.muted} style={{ marginVertical: 8 }} />
        )}

        <Text style={styles.description}>{product.description}</Text>

        {product.features.length > 0 && (
          <GlassPane
            scheme="light"
            intensity="regular"
            radius={Glass.radius.lg}
            noBlur
            style={styles.section}
            contentStyle={styles.sectionContent}
          >
            <Text style={styles.sectionTitle}>Highlights</Text>
            {product.features.map((feature, index) => (
              <View key={index} style={styles.featureRow}>
                <Ionicons name="checkmark-circle" size={18} color={Glass.tint.teal} />
                <Text style={styles.featureText}>{feature}</Text>
              </View>
            ))}
          </GlassPane>
        )}

        {product.sizes && product.sizes.length > 0 && (
          <GlassPane
            scheme="light"
            intensity="regular"
            radius={Glass.radius.lg}
            noBlur
            style={styles.section}
            contentStyle={styles.sectionContent}
          >
            <Text style={styles.sectionTitle}>Available Sizes</Text>
            <Text style={styles.metaText}>{product.sizes.join(' · ')}</Text>
          </GlassPane>
        )}

        {product.colors && product.colors.length > 0 && (
          <GlassPane
            scheme="light"
            intensity="regular"
            radius={Glass.radius.lg}
            noBlur
            style={styles.section}
            contentStyle={styles.sectionContent}
          >
            <Text style={styles.sectionTitle}>Colors</Text>
            <Text style={styles.metaText}>{product.colors.join(' · ')}</Text>
          </GlassPane>
        )}

        <TouchableOpacity style={styles.chatButton} onPress={() => router.push('/(tabs)/chat')}>
          <Ionicons name="chatbubbles" size={20} color="#fff" />
          <Text style={styles.chatButtonText}>Ask consultant about this item</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  headerPane: {
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: Glass.ink.light,
  },
  headerSpacer: {
    width: 32,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  heroImage: {
    width: '100%',
    height: 220,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: Glass.radius.lg,
    marginBottom: 16,
  },
  heroIcon: {
    width: 88,
    height: 88,
    borderWidth: 1,
    borderColor: Glass.stroke.lightOuter,
    borderRadius: Glass.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
    backgroundColor: 'rgba(255,255,255,0.62)',
  },
  category: {
    fontSize: 11,
    fontWeight: '700',
    color: Glass.ink.lightTertiary,
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  name: {
    fontSize: 26,
    fontWeight: '800',
    color: Glass.ink.light,
    textAlign: 'center',
    marginTop: 6,
  },
  price: {
    fontSize: 22,
    fontWeight: '800',
    color: Glass.tint.blue,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: Glass.ink.lightSecondary,
    textAlign: 'center',
    marginBottom: 24,
  },
  section: {
    marginBottom: 20,
  },
  sectionContent: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Glass.ink.light,
    marginBottom: 10,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
    gap: 8,
  },
  featureText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: Glass.ink.lightSecondary,
  },
  metaText: {
    fontSize: 14,
    color: Glass.ink.lightSecondary,
    lineHeight: 20,
  },
  chatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(16,20,37,0.92)',
    borderRadius: Glass.radius.pill,
    paddingVertical: 14,
    marginTop: 8,
    gap: 8,
  },
  chatButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
