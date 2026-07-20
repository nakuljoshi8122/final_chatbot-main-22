import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  NativeSyntheticEvent,
  NativeScrollEvent,
  LayoutChangeEvent,
  Text,
  Pressable,
  ViewToken,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  images: string[];
  height?: number;
  borderRadius?: number;
  fallbackColor?: string;
};

/** Horizontal paging gallery — works inside vertical ScrollViews. */
export default function ProductImageGallery({
  images,
  height = 220,
  borderRadius = 16,
  fallbackColor = '#B0B0B0',
}: Props) {
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<string>>(null);

  const urls = (images || []).map(String).filter(Boolean);
  const list = urls.length ? urls : [''];

  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && w !== width) setWidth(w);
  };

  const goTo = (i: number) => {
    if (!width || i < 0 || i >= list.length) return;
    listRef.current?.scrollToIndex({ index: i, animated: true });
    setIndex(i);
  };

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i >= 0 && i < list.length) setIndex(i);
  };

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const i = viewableItems[0]?.index;
      if (typeof i === 'number' && i >= 0) setIndex(i);
    },
  ).current;

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 60 }).current;

  const renderItem = useCallback(
    ({ item }: { item: string }) => (
      <View style={{ width: width || 1, height }} collapsable={false}>
        {item ? (
          <Image
            source={{ uri: item }}
            style={{ width: width || 1, height }}
            contentFit="cover"
            transition={100}
            pointerEvents="none"
          />
        ) : (
          <View style={[styles.fallback, { width: width || 1, height }]}>
            <Ionicons name="image-outline" size={40} color={fallbackColor} />
          </View>
        )}
      </View>
    ),
    [width, height, fallbackColor],
  );

  return (
    <View style={[styles.wrap, { height, borderRadius }]} onLayout={onLayout}>
      {width > 0 ? (
        <FlatList
          ref={listRef}
          data={list}
          keyExtractor={(uri, i) => `${uri}-${i}`}
          renderItem={renderItem}
          horizontal
          pagingEnabled
          nestedScrollEnabled
          directionalLockEnabled
          showsHorizontalScrollIndicator={false}
          bounces={false}
          onMomentumScrollEnd={onMomentumEnd}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          getItemLayout={(_, i) => ({
            length: width,
            offset: width * i,
            index: i,
          })}
          style={{ width, height }}
          // Keep horizontal gestures from being stolen by parent vertical scroll
          scrollEventThrottle={16}
          decelerationRate="fast"
        />
      ) : null}

      {list.length > 1 ? (
        <>
          <Pressable
            style={[styles.arrow, styles.arrowLeft]}
            onPress={() => goTo(index - 1)}
            hitSlop={8}
            disabled={index <= 0}
          >
            <Ionicons
              name="chevron-back"
              size={18}
              color={index <= 0 ? 'rgba(255,255,255,0.35)' : '#fff'}
            />
          </Pressable>
          <Pressable
            style={[styles.arrow, styles.arrowRight]}
            onPress={() => goTo(index + 1)}
            hitSlop={8}
            disabled={index >= list.length - 1}
          >
            <Ionicons
              name="chevron-forward"
              size={18}
              color={index >= list.length - 1 ? 'rgba(255,255,255,0.35)' : '#fff'}
            />
          </Pressable>
          <View style={styles.dots} pointerEvents="none">
            {list.map((_, i) => (
              <View key={i} style={[styles.dot, i === index && styles.dotOn]} />
            ))}
          </View>
          <View style={styles.countPill} pointerEvents="none">
            <Text style={styles.countText}>
              {index + 1}/{list.length}
            </Text>
          </View>
        </>
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
  arrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  arrowLeft: { left: 8 },
  arrowRight: { right: 8 },
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
