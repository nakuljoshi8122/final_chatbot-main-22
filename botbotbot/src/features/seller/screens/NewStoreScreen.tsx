import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/shared/ui/ThemedText';
import { createStore } from '@/services/storesApi';
import { useApp } from '@/contexts/AppContext';
import { GlassPane, GlassPill, GlassScreen } from '@/shared/ui/Glass';
import { Glass } from '@/shared/theme/LiquidGlass';
import { SellerTheme } from '@/shared/theme/SellerTheme';

const CATEGORIES = ['Skincare', 'Apparel', 'Handicrafts'] as const;

export default function NewStoreScreen() {
  const router = useRouter();
  const { selectStore, refreshStores } = useApp();
  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('Handicrafts');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  const onCreate = async () => {
    if (!name.trim() || !ownerName.trim()) {
      Alert.alert('Required', 'Store name and owner name are required.');
      return;
    }
    setSaving(true);
    try {
      const res = await createStore({
        name: name.trim(),
        owner_name: ownerName.trim(),
        owner_email: ownerEmail.trim(),
        owner_phone: ownerPhone.trim(),
        category,
        description: description.trim(),
        address: address.trim(),
      });
      if (!res.ok || !res.store) {
        Alert.alert('Error', res.error || 'Could not create store');
        return;
      }
      await refreshStores();
      await selectStore(res.store);
      router.replace(`/seller/${res.store.id}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <GlassScreen scheme="light">
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <GlassPane scheme="light" intensity="regular" radius={0} flat>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
              <Ionicons name="close" size={24} color={Glass.ink.light} />
            </TouchableOpacity>
            <ThemedText style={styles.title}>Open a new store</ThemedText>
            <View style={{ width: 24 }} />
          </View>
        </GlassPane>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 56 : 0}
        >
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
        <ThemedText style={styles.label}>Store name *</ThemedText>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Glow Lab"
          placeholderTextColor={SellerTheme.textSecondary}
        />

        <ThemedText style={styles.label}>Owner name *</ThemedText>
        <TextInput
          style={styles.input}
          value={ownerName}
          onChangeText={setOwnerName}
          placeholder="Your name"
          placeholderTextColor={SellerTheme.textSecondary}
        />

        <ThemedText style={styles.label}>Category / domain *</ThemedText>
        <View style={styles.chips}>
          {CATEGORIES.map((c) => (
            <TouchableOpacity
              key={c}
              onPress={() => setCategory(c)}
            >
              <GlassPill
                scheme="light"
                active={category === c}
                activeColor={SellerTheme.chipActive}
                style={styles.chip}
              >
                <ThemedText style={[styles.chipText, category === c && styles.chipTextOn]}>
                  {c === 'Apparel' ? 'Apparels' : c}
                </ThemedText>
              </GlassPill>
            </TouchableOpacity>
          ))}
        </View>

        <ThemedText style={styles.label}>Owner email</ThemedText>
        <TextInput
          style={styles.input}
          value={ownerEmail}
          onChangeText={setOwnerEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          placeholderTextColor={SellerTheme.textSecondary}
        />

        <ThemedText style={styles.label}>Owner phone</ThemedText>
        <TextInput
          style={styles.input}
          value={ownerPhone}
          onChangeText={setOwnerPhone}
          keyboardType="phone-pad"
          placeholderTextColor={SellerTheme.textSecondary}
        />

        <ThemedText style={styles.label}>Description</ThemedText>
        <TextInput
          style={[styles.input, { height: 80 }]}
          value={description}
          onChangeText={setDescription}
          multiline
          placeholderTextColor={SellerTheme.textSecondary}
        />

        <ThemedText style={styles.label}>Address</ThemedText>
        <TextInput
          style={styles.input}
          value={address}
          onChangeText={setAddress}
          placeholderTextColor={SellerTheme.textSecondary}
        />

        <TouchableOpacity
          style={styles.submit}
          onPress={onCreate}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <ThemedText style={styles.submitText}>Create store</ThemedText>
          )}
        </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { fontSize: 17, fontWeight: '700', color: SellerTheme.text },
  label: { fontSize: 13, fontWeight: '700', color: SellerTheme.text, marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: Glass.fill.light,
    borderWidth: 1,
    borderColor: Glass.stroke.lightOuter,
    borderRadius: Glass.radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: SellerTheme.text,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Glass.radius.pill,
  },
  chipText: { color: SellerTheme.text, fontWeight: '600' },
  chipTextOn: { color: SellerTheme.chipActiveText },
  submit: {
    marginTop: 24,
    backgroundColor: Glass.tint.blue,
    borderRadius: Glass.radius.pill,
    paddingVertical: 16,
    alignItems: 'center',
    ...Glass.shadowSoft,
  },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
