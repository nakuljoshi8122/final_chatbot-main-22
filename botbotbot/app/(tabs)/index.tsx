import React from 'react';
import { StyleSheet, View } from 'react-native';
import ChatInterface from '@/components/ChatInterface';
import { Brand } from '@/constants/Brand';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <ChatInterface />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Brand.colors.background,
  },
});
