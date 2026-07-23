import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { StyleSheet, View } from 'react-native';
import { Glass } from '@/shared/theme/LiquidGlass';

export default function BlurTabBarBackground() {
  return (
    <View style={styles.background}>
      <BlurView
        tint="light"
        intensity={Glass.blur.strong}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.frost} />
    </View>
  );
}

const styles = StyleSheet.create({
  background: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Glass.stroke.lightOuter,
  },
  frost: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Glass.fill.lightSoft,
  },
});

export function useBottomTabOverflow() {
  return useBottomTabBarHeight();
}
