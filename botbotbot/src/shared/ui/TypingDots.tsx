import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Glass } from '@/shared/theme/LiquidGlass';

interface Props {
  color?: string;
  size?: number;
}

/** Three dots that rise and fall one-by-one in a smooth periodic loop. */
export default function TypingDots({ color = Glass.ink.lightSecondary, size = 7 }: Props) {
  const d0 = useRef(new Animated.Value(0)).current;
  const d1 = useRef(new Animated.Value(0)).current;
  const d2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const dots = [d0, d1, d2];
    const step = 180;
    const loops = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * step),
          Animated.timing(d, {
            toValue: 1,
            duration: 300,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(d, {
            toValue: 0,
            duration: 300,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay((dots.length - 1 - i) * step),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [d0, d1, d2]);

  const dotStyle = (v: Animated.Value) => [
    {
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: color,
      transform: [
        {
          translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -size] }),
        },
      ],
      opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
    },
  ];

  return (
    <View style={styles.row}>
      <Animated.View style={dotStyle(d0)} />
      <Animated.View style={dotStyle(d1)} />
      <Animated.View style={dotStyle(d2)} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 5,
    height: 16,
  },
});
