import React, { useEffect } from 'react';
import { StyleSheet, View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import ChatInterface from '@/features/legacy-store/components/ChatInterface';
import { useStore } from '@/features/legacy-store/context/StoreContext';

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
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#111" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: '#F5F5F5' }]}>
      <ChatInterface key={store.id} />
    </View>
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
    backgroundColor: '#F5F5F5',
  },
});
