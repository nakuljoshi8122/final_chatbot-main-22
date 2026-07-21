import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

/** Gentle bounce loop — lifts up then springs to rest; pauses between cycles. */
export function usePeriodicBounce(active: boolean) {
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      translateY.stopAnimation();
      translateY.setValue(0);
      return;
    }

    let cancelled = false;

    const runBounce = () => {
      if (cancelled) return;
      Animated.sequence([
        Animated.timing(translateY, {
          toValue: -14,
          duration: 200,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(translateY, {
          toValue: 0,
          friction: 4,
          tension: 140,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished && !cancelled) {
          setTimeout(runBounce, 3000);
        }
      });
    };

    const starter = setTimeout(runBounce, 800);
    return () => {
      cancelled = true;
      clearTimeout(starter);
      translateY.stopAnimation();
      translateY.setValue(0);
    };
  }, [active, translateY]);

  return translateY;
}
