import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';

export function useScreenInsets() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();

  return {
    top: insets.top,
    bottom: insets.bottom,
    tabBarHeight,
    headerPaddingTop: insets.top + 8,
    contentBottomPadding: tabBarHeight + 16,
    inputBottomPadding: tabBarHeight + 8,
  };
}
