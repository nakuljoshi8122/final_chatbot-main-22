import React, { useEffect } from 'react';
import { StyleSheet, View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import ChatInterface from '@/features/legacy-store/components/ChatInterface';
import { useStore } from '@/features/legacy-store/context/StoreContext';
import { GlassScreen } from '@/shared/ui/Glass';
import { Glass } from '@/shared/theme/LiquidGlass';

export default function ChatScreen() {
  const router = useRouter();
  const { store, ready } = useStore();

  useEffect(() => {
    if (ready && !store) {
      router.replace('/');
    }
  }, [ready, store, router]);

  if (!ready || !store) {
    return (
      <GlassScreen scheme="light">
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={Glass.ink.light} />
        </View>
      </GlassScreen>
    );
  }

  return (
    <GlassScreen scheme="light" plain style={styles.container}>
      <ChatInterface key={store.id} />
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
});
