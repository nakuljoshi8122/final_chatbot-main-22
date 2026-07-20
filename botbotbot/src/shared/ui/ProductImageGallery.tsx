import React, { useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
  LayoutChangeEvent,
  Text,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  images: string[];
  height?: number;
  borderRadius?: number;
  fallbackColor?: string;
};

/** Horizontal paging gallery for product detail sheets. */
export default function ProductImageGallery({
  images,
  height = 220,
  borderRadius = 16,
  fallbackColor = '#B0B0B0',
}: Props) {
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const urls = (images || []).map(String).filter(Boolean);
  const list = urls.length ? urls : [''];

  const onLayout = (e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index && i >= 0 && i < list.length) setIndex(i);
  };

  return (
    <View style={[styles.wrap, { height, borderRadius }]} onLayout={onLayout}>
      {width > 0 ? (
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          style={{ width, height }}
        >
          {list.map((uri, i) => (
            <View key={`${uri}-${i}`} style={{ width, height }}>
              {uri ? (
                <Image
                  source={{ uri }}
                  style={{ width, height }}
                  contentFit="cover"
                  transition={120}
                />
              ) : (
                <View style={[styles.fallback, { width, height }]}>
                  <Ionicons name="image-outline" size={40} color={fallbackColor} />
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      ) : null}

      {list.length > 1 ? (
        <View style={styles.dots}>
          {list.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === index && styles.dotOn]}
            />
          ))}
        </View>
      ) : null}

      {list.length > 1 ? (
        <View style={styles.countPill}>
          <Text style={styles.countText}>
            {index + 1}/{list.length}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    backgroundColor: '#F2F2F2',
    position: 'relative',
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2F2F2',
  },
  dots: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  dotOn: {
    backgroundColor: '#fff',
    width: 16,
  },
  countPill: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  countText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
});
