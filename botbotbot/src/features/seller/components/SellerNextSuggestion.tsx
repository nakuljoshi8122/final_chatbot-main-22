import React, { useEffect, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { GlassPill } from '@/shared/ui/Glass';
import { Glass } from '@/shared/theme/LiquidGlass';
import { SellerTheme } from '@/shared/theme/SellerTheme';

export type ChatSuggestion = {
  label: string;
  message: string;
};

type Props = {
  suggestions: ChatSuggestion[];
  disabled?: boolean;
  /** Auto-advance delay between chips (ms). */
  intervalMs?: number;
  onSelect: (suggestion: ChatSuggestion) => void;
};

const TAP_MOVE_MAX = 10;
const TAP_MS_MAX = 450;

/**
 * Horizontal suggestion pager:
 * - Swipe left → next question, swipe right → previous (natural scroll)
 * - Auto-advances when idle
 * - Only a true tap (not a drag) sends the prompt to Assist
 */
export default function SellerNextSuggestion({
  suggestions,
  disabled,
  intervalMs = 4200,
  onSelect,
}: Props) {
  const [index, setIndex] = useState(0);
  const [pageWidth, setPageWidth] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const indexRef = useRef(0);
  const draggingRef = useRef(false);
  const suppressTapRef = useRef(false);
  const pausedUntilRef = useRef(0);
  const touchRef = useRef({ x: 0, y: 0, t: 0, moved: false });

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  // New suggestion batch → jump to first page.
  useEffect(() => {
    setIndex(0);
    indexRef.current = 0;
    suppressTapRef.current = false;
    draggingRef.current = false;
    if (pageWidth > 0) {
      scrollRef.current?.scrollTo({ x: 0, animated: false });
    }
  }, [suggestions, pageWidth]);

  // Auto-advance when idle (paused after manual swipe / tap).
  useEffect(() => {
    if (suggestions.length <= 1 || pageWidth <= 0) return;
    const tick = setInterval(() => {
      if (draggingRef.current) return;
      if (Date.now() < pausedUntilRef.current) return;
      const next = (indexRef.current + 1) % suggestions.length;
      scrollRef.current?.scrollTo({ x: next * pageWidth, animated: true });
      setIndex(next);
    }, intervalMs);
    return () => clearInterval(tick);
  }, [suggestions.length, intervalMs, pageWidth]);

  const pauseAuto = (ms = 10000) => {
    pausedUntilRef.current = Date.now() + ms;
  };

  const syncIndexFromOffset = (x: number) => {
    if (pageWidth <= 0) return;
    const i = Math.round(x / pageWidth);
    const clamped = Math.max(0, Math.min(i, suggestions.length - 1));
    setIndex(clamped);
  };

  const onScrollBeginDrag = () => {
    draggingRef.current = true;
    suppressTapRef.current = true;
    touchRef.current.moved = true;
    pauseAuto(12000);
  };

  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    syncIndexFromOffset(e.nativeEvent.contentOffset.x);
    draggingRef.current = false;
    // Drop the synthetic "press" that often follows a fling.
    setTimeout(() => {
      suppressTapRef.current = false;
      touchRef.current.moved = false;
    }, 80);
  };

  const onScrollEndDrag = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // If velocity is ~0, momentum may not fire — sync page now.
    const { contentOffset, velocity } = e.nativeEvent;
    const vx = Math.abs(velocity?.x ?? 0);
    if (vx < 0.05) {
      syncIndexFromOffset(contentOffset.x);
      draggingRef.current = false;
      setTimeout(() => {
        suppressTapRef.current = false;
        touchRef.current.moved = false;
      }, 80);
    }
  };

  const onTouchStart = (pageX: number, pageY: number) => {
    touchRef.current = { x: pageX, y: pageY, t: Date.now(), moved: false };
    // Don't clear suppressTap here if a scroll just ended — momentum handler owns that.
    if (!draggingRef.current) suppressTapRef.current = false;
  };

  const onTouchMove = (pageX: number, pageY: number) => {
    const dx = Math.abs(pageX - touchRef.current.x);
    const dy = Math.abs(pageY - touchRef.current.y);
    // Horizontal intent → scrolling, never a tap.
    if (dx > TAP_MOVE_MAX || dy > TAP_MOVE_MAX) {
      touchRef.current.moved = true;
      suppressTapRef.current = true;
    }
  };

  const trySelect = (suggestion: ChatSuggestion) => {
    if (disabled) return;
    if (draggingRef.current || suppressTapRef.current || touchRef.current.moved) return;
    if (Date.now() - touchRef.current.t > TAP_MS_MAX) return;
    pauseAuto(8000);
    onSelect(suggestion);
  };

  if (!suggestions.length) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.hint}>Suggested next · swipe for more</Text>
      <GlassPill scheme="light" style={styles.pill}>
        <View
          style={styles.pager}
          onLayout={(e) => {
            const w = Math.round(e.nativeEvent.layout.width);
            if (w > 0 && w !== pageWidth) setPageWidth(w);
          }}
        >
          {pageWidth > 0 ? (
            <ScrollView
              ref={scrollRef}
              horizontal
              pagingEnabled
              bounces
              decelerationRate="fast"
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              scrollEventThrottle={16}
              onScrollBeginDrag={onScrollBeginDrag}
              onScrollEndDrag={onScrollEndDrag}
              onMomentumScrollEnd={onMomentumScrollEnd}
              // Natural direction: finger left → next, finger right → previous
            >
              {suggestions.map((s, i) => (
                <View
                  key={`${s.message}-${i}`}
                  style={[styles.page, { width: pageWidth }]}
                  onTouchStart={(e) =>
                    onTouchStart(e.nativeEvent.pageX, e.nativeEvent.pageY)
                  }
                  onTouchMove={(e) =>
                    onTouchMove(e.nativeEvent.pageX, e.nativeEvent.pageY)
                  }
                >
                  <Pressable
                    style={styles.chip}
                    disabled={disabled}
                    onPress={() => trySelect(s)}
                  >
                    <Text style={styles.question} numberOfLines={2}>
                      {s.message || s.label}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          ) : (
            <View style={styles.chip}>
              <Text style={styles.question} numberOfLines={2}>
                {suggestions[0]?.message || suggestions[0]?.label}
              </Text>
            </View>
          )}
        </View>
      </GlassPill>
      {suggestions.length > 1 ? (
        <View style={styles.dots}>
          {suggestions.map((_, i) => (
            <View key={`dot-${i}`} style={[styles.dot, i === index && styles.dotOn]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 6,
    gap: 6,
  },
  hint: {
    fontSize: 11,
    fontWeight: '700',
    color: SellerTheme.textSecondary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  pill: {
    alignSelf: 'stretch',
    overflow: 'hidden',
  },
  pager: {
    width: '100%',
    minHeight: 48,
  },
  page: {
    justifyContent: 'center',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  question: {
    fontSize: 14,
    fontWeight: '600',
    color: SellerTheme.text,
    lineHeight: 20,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
    paddingTop: 2,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(24,30,54,0.18)',
  },
  dotOn: {
    backgroundColor: Glass.tint.blue,
    width: 12,
  },
});
