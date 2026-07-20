import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  message: string | null;
  onUndo?: () => void;
  onDismiss: () => void;
  durationMs?: number;
};

/** Soft bottom toast with optional Undo — keeps quick edits feeling safe. */
export default function UndoToast({
  message,
  onUndo,
  onDismiss,
  durationMs = 4500,
}: Props) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return;
    Animated.spring(anim, {
      toValue: 1,
      useNativeDriver: true,
      friction: 8,
    }).start();
    const t = setTimeout(() => {
      Animated.timing(anim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start(() => onDismiss());
    }, durationMs);
    return () => clearTimeout(t);
  }, [message, anim, durationMs, onDismiss]);

  if (!message) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [24, 0],
              }),
            },
          ],
        },
      ]}
    >
      <View style={styles.toast}>
        <Text style={styles.text} numberOfLines={2}>
          {message}
        </Text>
        {onUndo ? (
          <Pressable
            onPress={() => {
              onUndo();
              onDismiss();
            }}
            hitSlop={8}
          >
            <Text style={styles.undo}>Undo</Text>
          </Pressable>
        ) : (
          <Pressable onPress={onDismiss} hitSlop={8}>
            <Text style={styles.undo}>OK</Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 24,
    zIndex: 100,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  text: { flex: 1, color: '#fff', fontSize: 14, fontWeight: '600' },
  undo: { color: '#6CB4FF', fontWeight: '800', fontSize: 14 },
});
