import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  Linking,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Brand } from '@/shared/theme/Brand';
import { TileProduct } from '@/shared/utils/parseTiles';
import { getProductDiscount, withDollar } from '@/shared/utils/productDiscount';

interface ProductTileCardProps {
  product: TileProduct;
  onSelect?: (product: TileProduct) => void;
  /** When provided, replaces the default open behavior (e.g. seller enlarge modal). */
  onPressOverride?: (product: TileProduct) => void;
}

export default function ProductTileCard({ product, onSelect, onPressOverride }: ProductTileCardProps) {
  const router = useRouter();
  const [pressed, setPressed] = useState(false);
  const [imgError, setImgError] = useState(false);

  const openProduct = async () => {
    if (onPressOverride) {
      onPressOverride(product);
      return;
    }
    onSelect?.(product);

    if (product.id && !product.id.startsWith('tile-')) {
      router.push({
        pathname: '/product/[id]',
        params: {
          id: product.id,
          name: product.name,
          price: product.price,
          category: product.category || '',
          description: product.description || '',
          features: JSON.stringify(product.features || []),
          icon: product.icon || 'footsteps',
        },
      });
      return;
    }

    if (Platform.OS === 'web') {
      const opener = (globalThis as { open?: (url: string, target?: string) => void }).open;
      opener?.(product.url, '_blank');
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(product.url);
    } catch {
      Linking.openURL(product.url);
    }
  };

  const features = product.features?.slice(0, 2) ?? [];
  const discount = getProductDiscount(product.price, product.list_price);

  return (
    <Pressable
      onPress={openProduct}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.imageWrap}>
        {!imgError ? (
          <Image
            source={{ uri: product.img }}
            style={styles.image}
            contentFit="cover"
            transition={150}
            onError={() => setImgError(true)}
          />
        ) : (
          <View style={styles.imageFallback}>
            <Ionicons name="image-outline" size={24} color={Brand.colors.muted} />
          </View>
        )}
        {discount ? (
          <View style={styles.promoBadge}>
            <Text style={styles.promoBadgeText}>{discount.percentOff}% OFF</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={2}>{product.name}</Text>
          {product.tag ? (
            <View style={styles.tagBadge}>
              <Text style={styles.tagText}>{product.tag}</Text>
            </View>
          ) : null}
        </View>

        {product.color ? (
          <Text style={styles.colorText} numberOfLines={1}>{product.color}</Text>
        ) : null}
        {discount ? (
          <View style={styles.priceRow}>
            <Text style={styles.listPrice}>{withDollar(product.list_price)}</Text>
            <Text style={styles.salePrice}>{withDollar(product.price)}</Text>
          </View>
        ) : (
          <Text style={styles.price}>{withDollar(product.price)}</Text>
        )}

        {features.length > 0 && (
          <View style={styles.features}>
            {features.map((item, index) => (
              <Text key={index} style={styles.featureItem} numberOfLines={1}>• {item}</Text>
            ))}
          </View>
        )}
      </View>
    </Pressable>
  );
}

interface ProductTileGridProps {
  tiles: TileProduct[];
  showMore?: boolean;
  onShowMore?: () => void;
  onTileSelect?: (product: TileProduct) => void;
  /** When provided, replaces the default open behavior for every tile. */
  onTilePressOverride?: (product: TileProduct) => void;
}

const TILE_WIDTH = 168;

export function ProductTileGrid({ tiles, showMore = false, onShowMore, onTileSelect, onTilePressOverride }: ProductTileGridProps) {
  if (!tiles.length) return null;

  return (
    <View style={styles.rail}>
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.railContent}
        decelerationRate="fast"
      >
        {tiles.map((tile) => (
          <View key={tile.id} style={styles.tileSlot}>
            <ProductTileCard
              product={tile}
              onSelect={onTileSelect}
              onPressOverride={onTilePressOverride}
            />
          </View>
        ))}
        {showMore && onShowMore ? (
          <Pressable
            onPress={onShowMore}
            style={({ pressed }) => [styles.showMoreCard, pressed && styles.showMoreBtnPressed]}
          >
            <Text style={styles.showMoreText}>Show more</Text>
            <Ionicons name="arrow-forward" size={16} color={Brand.colors.primary} />
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    marginTop: 6,
    marginHorizontal: -4,
  },
  railContent: {
    paddingHorizontal: 4,
    paddingBottom: 2,
    alignItems: 'stretch',
  },
  tileSlot: {
    width: TILE_WIDTH,
    marginRight: 10,
  },
  card: {
    width: TILE_WIDTH,
    backgroundColor: Brand.colors.accent,
    borderWidth: 1,
    borderColor: Brand.colors.border,
    overflow: 'hidden',
    flex: 1,
  },
  cardPressed: {
    borderColor: Brand.colors.primary,
  },
  imageWrap: {
    position: 'relative',
  },
  image: {
    width: TILE_WIDTH,
    height: 120,
    backgroundColor: Brand.colors.background,
  },
  imageFallback: {
    width: TILE_WIDTH,
    height: 120,
    backgroundColor: Brand.colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Brand.colors.border,
  },
  promoBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#C62828',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  promoBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.2,
  },
  body: {
    padding: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  name: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: Brand.colors.primary,
    lineHeight: 15,
  },
  tagBadge: {
    borderWidth: 1,
    borderColor: Brand.colors.border,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  tagText: {
    fontSize: 10,
    fontWeight: '700',
    color: Brand.colors.primary,
    textTransform: 'uppercase',
  },
  colorText: {
    fontSize: 11,
    color: Brand.colors.muted,
    marginTop: 3,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  listPrice: {
    fontSize: 11,
    fontWeight: '600',
    color: '#C62828',
    textDecorationLine: 'line-through',
  },
  salePrice: {
    fontSize: 11,
    fontWeight: '800',
    color: Brand.colors.primary,
  },
  price: {
    fontSize: 11,
    fontWeight: '700',
    color: Brand.colors.primary,
    marginTop: 2,
  },
  features: {
    marginTop: 4,
  },
  featureItem: {
    fontSize: 10,
    lineHeight: 13,
    color: Brand.colors.highlight,
  },
  showMoreCard: {
    width: 112,
    minHeight: 180,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  showMoreBtnPressed: {
    backgroundColor: '#F5F5F5',
  },
  showMoreText: {
    fontSize: 11,
    color: '#000000',
    fontWeight: '500',
  },
});
