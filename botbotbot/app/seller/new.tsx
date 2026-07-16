import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/ThemedText';
import { createStore } from '@/services/storesApi';
import { useApp } from '@/context/AppContext';

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
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="close" size={24} color="#111" />
        </TouchableOpacity>
        <ThemedText style={styles.title}>Open a new store</ThemedText>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <ThemedText style={styles.label}>Store name *</ThemedText>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Glow Lab" />

        <ThemedText style={styles.label}>Owner name *</ThemedText>
        <TextInput
          style={styles.input}
          value={ownerName}
          onChangeText={setOwnerName}
          placeholder="Your name"
        />

        <ThemedText style={styles.label}>Category / domain *</ThemedText>
        <View style={styles.chips}>
          {CATEGORIES.map((c) => (
            <TouchableOpacity
              key={c}
              style={[styles.chip, category === c && styles.chipOn]}
              onPress={() => setCategory(c)}
            >
              <ThemedText style={[styles.chipText, category === c && styles.chipTextOn]}>
                {c === 'Apparel' ? 'Apparels' : c}
              </ThemedText>
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
        />

        <ThemedText style={styles.label}>Owner phone</ThemedText>
        <TextInput
          style={styles.input}
          value={ownerPhone}
          onChangeText={setOwnerPhone}
          keyboardType="phone-pad"
        />

        <ThemedText style={styles.label}>Description</ThemedText>
        <TextInput
          style={[styles.input, { height: 80 }]}
          value={description}
          onChangeText={setDescription}
          multiline
        />

        <ThemedText style={styles.label}>Address</ThemedText>
        <TextInput style={styles.input} value={address} onChangeText={setAddress} />

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F4F2' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E6E6E6',
  },
  title: { fontSize: 17, fontWeight: '700', color: '#111' },
  label: { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#E8E8E8',
  },
  chipOn: { backgroundColor: '#1D3557' },
  chipText: { color: '#333', fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  submit: {
    marginTop: 24,
    backgroundColor: '#1D3557',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
