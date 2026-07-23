import { StyleSheet, View } from 'react-native';
import { Glass } from '@/shared/theme/LiquidGlass';

export default function TabBarBackground() {
  return <View style={styles.background} />;
}

export function useBottomTabOverflow() {
  return 0;
}

const styles = StyleSheet.create({
  background: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Glass.stroke.lightOuter,
  },
});
