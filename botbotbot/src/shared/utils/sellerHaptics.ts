import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/** Light haptic for lazy-seller quick actions (no-op on web). */
export function tapHaptic() {
  if (Platform.OS === 'web') return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export function successHaptic() {
  if (Platform.OS === 'web') return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

export function warnHaptic() {
  if (Platform.OS === 'web') return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
}
