import { Link, Stack } from 'expo-router';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/shared/ui/ThemedText';
import { GlassPane, GlassScreen } from '@/shared/ui/Glass';
import { Glass } from '@/shared/theme/LiquidGlass';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <GlassScreen scheme="light" style={styles.container}>
        <GlassPane scheme="light" intensity="regular" radius={Glass.radius.lg} contentStyle={styles.pane}>
          <ThemedText type="title" style={styles.title}>This screen does not exist.</ThemedText>
          <Link href="/" style={styles.link}>
            <ThemedText type="link">Go to home screen!</ThemedText>
          </Link>
        </GlassPane>
      </GlassScreen>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  pane: {
    alignItems: 'center',
    padding: 28,
  },
  title: {
    color: Glass.ink.light,
    textAlign: 'center',
  },
});
