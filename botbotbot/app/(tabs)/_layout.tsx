import { Tabs } from 'expo-router';
import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/shared/ui/HapticTab';
import { IconSymbol } from '@/shared/ui/IconSymbol';
import TabBarBackground from '@/shared/ui/TabBarBackground';
import { Colors } from '@/shared/theme/Colors';
import { Brand } from '@/shared/theme/Brand';
import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { Glass } from '@/shared/theme/LiquidGlass';

const TAB_BAR_CONTENT_HEIGHT = 56;

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const tabBarHeight = TAB_BAR_CONTENT_HEIGHT + insets.bottom;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Brand.colors.primary,
        tabBarInactiveTintColor: Colors[colorScheme ?? 'light'].tabIconDefault,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarBackground: TabBarBackground,
        tabBarStyle: Platform.select({
          ios: {
            position: 'absolute',
            height: tabBarHeight,
            paddingBottom: insets.bottom,
            paddingTop: 8,
            backgroundColor: 'transparent',
            borderTopColor: 'transparent',
            borderTopWidth: 0,
          },
          default: {
            height: tabBarHeight,
            paddingBottom: insets.bottom,
            paddingTop: 8,
            backgroundColor: 'rgba(255,255,255,0.88)',
            borderTopColor: Glass.stroke.lightOuter,
            borderTopWidth: StyleSheet.hairlineWidth,
          },
        }),
      }}>
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="message.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Shop',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="bag.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Store',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="building.2.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}
