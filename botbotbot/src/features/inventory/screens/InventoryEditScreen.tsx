import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ActionSheetIOS,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  SellerTheme,
  SELLER_CATEGORIES,
  SellerCategory,
} from '@/shared/theme/SellerTheme';
import {
  createInventoryItem,
  getInventoryItem,
  hydrateInventoryFromApi,
  persistPickedImage,
  productImageUrl,
  updateInventoryItem,
} from '@/services/inventoryStore';
import { fetchSellerProduct } from '@/services/storesApi';

function resolveParam(value: string | string[] | undefined): string {
  if (!value) return '';
  return Array.isArray(value) ? value[0] : value;
}

function categoryHint(category: SellerCategory): string {
  switch (category) {
    case 'Handicrafts':
      return 'Material / care notes (optional)';
    case 'Apparel':
      return 'Sizes / material notes (optional)';
    case 'Skincare':
      return 'Ingredients / size notes (optional)';
  }
}

export default function InventoryEditScreen() {
  const router = useRouter();
  const { id: rawId, category: rawCategory, storeId: rawStoreId } = useLocalSearchParams<{
    id?: string;
    category?: string;
    storeId?: string;
  }>();
  const editId = resolveParam(rawId);
  const isEdit = !!editId;
  const presetCategory = resolveParam(rawCategory);
  const storeId = resolveParam(rawStoreId);

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<SellerCategory>(
    presetCategory === 'Skincare' ||
      presetCategory === 'Apparel' ||
      presetCategory === 'Handicrafts'
      ? presetCategory
      : 'Handicrafts',
  );
  const [price, setPrice] = useState('');
  const [sku, setSku] = useState('');
  const [description, setDescription] = useState('');
  const [categoryNotes, setCategoryNotes] = useState('');
  const [quantity, setQuantity] = useState('10');
  const [status, setStatus] = useState<'active' | 'draft'>('active');
  const [imageUri, setImageUri] = useState<string | undefined>();
  const [customPhoto, setCustomPhoto] = useState(false);

  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    (async () => {
      try {
        let item = await getInventoryItem(editId);
        if (!item) {
          // Chat-listed products live on the API first — hydrate into local store
          const remote = await fetchSellerProduct(editId, storeId || undefined);
          if (remote) {
            item = await hydrateInventoryFromApi(remote);
          }
        }
        if (cancelled || !item) return;
        setName(item.name);
        setCategory(item.category);
        setPrice(item.price);
        setSku(item.sku);
        setDescription(item.description);
        setCategoryNotes(item.categoryNotes);
        setQuantity(String(item.quantity));
        setStatus(item.status === 'draft' ? 'draft' : 'active');
        setImageUri(item.imageUri);
        setCustomPhoto(!!item.imageUri && !item.imageUri.includes('/product-images/'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editId, storeId]);

  const previewUri = useMemo(() => {
    if (imageUri) return imageUri;
    if (sku.trim()) return productImageUrl(sku.trim());
    return undefined;
  }, [imageUri, sku]);

  const applyPickedUri = async (uri: string) => {
    setPicking(true);
    try {
      const stored = await persistPickedImage(uri, sku.trim() || 'new');
      setImageUri(stored);
      setCustomPhoto(true);
    } catch (err) {
      Alert.alert(
        'Could not save photo',
        err instanceof Error ? err.message : 'Try another image.',
      );
    } finally {
      setPicking(false);
    }
  };

  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to attach a product image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      await applyPickedUri(result.assets[0].uri);
    }
  };

  const pickFromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow camera access to take a product photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      await applyPickedUri(result.assets[0].uri);
    }
  };

  const onAddPhoto = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Choose from library', 'Take photo', 'Clear photo'],
          cancelButtonIndex: 0,
          destructiveButtonIndex: 3,
        },
        (index) => {
          if (index === 1) void pickFromLibrary();
          if (index === 2) void pickFromCamera();
          if (index === 3) {
            setImageUri(undefined);
            setCustomPhoto(false);
          }
        },
      );
      return;
    }
    Alert.alert('Product photo', 'Add an image from your device', [
      { text: 'Library', onPress: () => void pickFromLibrary() },
      { text: 'Camera', onPress: () => void pickFromCamera() },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          setImageUri(undefined);
          setCustomPhoto(false);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const onSave = async () => {
    if (!name.trim()) {
      Alert.alert('Missing name', 'Please enter a product name.');
      return;
    }
    const qty = Number.parseInt(quantity, 10);
    if (Number.isNaN(qty) || qty < 0) {
      Alert.alert('Invalid stock', 'Quantity must be a non-negative number.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name,
        category,
        price,
        sku: sku.trim() || undefined,
        description,
        categoryNotes,
        quantity: qty,
        status,
        imageUri: customPhoto ? imageUri : previewUri,
        storeId: storeId || undefined,
      };
      if (isEdit) {
        // Ensure chat-created SKUs exist locally before update
        const existing = await getInventoryItem(editId);
        if (!existing) {
          await hydrateInventoryFromApi({
            sku: sku.trim() || editId,
            name,
            category,
            price,
            description,
            category_notes: categoryNotes,
            quantity: qty,
            status,
            img: customPhoto ? imageUri : previewUri,
            store_id: storeId || undefined,
          });
        }
        await updateInventoryItem(editId, payload);
      } else {
        await createInventoryItem(payload);
      }
      router.back();
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={{ marginTop: 40 }} color={SellerTheme.textSecondary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.headerBtn}>
          <Ionicons name="close" size={24} color={SellerTheme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEdit ? 'Edit product' : 'List product'}</Text>
        <TouchableOpacity
          onPress={onSave}
          disabled={saving}
          hitSlop={12}
          style={styles.headerBtn}
        >
          <Text style={[styles.saveText, saving && { opacity: 0.5 }]}>
            {saving ? '…' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.form}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity
            style={styles.photoBlock}
            onPress={onAddPhoto}
            disabled={picking}
            activeOpacity={0.85}
          >
            {previewUri ? (
              <Image source={{ uri: previewUri }} style={styles.photo} contentFit="cover" />
            ) : (
              <View style={[styles.photo, styles.photoPlaceholder]}>
                <Ionicons name="images-outline" size={32} color={SellerTheme.textSecondary} />
                <Text style={styles.photoHint}>Tap to add photo</Text>
              </View>
            )}
            <View style={styles.photoActions}>
              <Ionicons name="camera" size={16} color={SellerTheme.accent} />
              <Text style={styles.photoActionText}>
                {picking
                  ? 'Saving…'
                  : customPhoto
                    ? 'Change / clear photo'
                    : 'Upload from library or camera'}
              </Text>
            </View>
          </TouchableOpacity>

          <Text style={styles.label}>Product name *</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Handwoven Jute Basket"
            placeholderTextColor={SellerTheme.textSecondary}
          />

          <Text style={styles.label}>Category *</Text>
          <View style={styles.chips}>
            {SELLER_CATEGORIES.map((cat) => {
              const active = category === cat;
              return (
                <TouchableOpacity
                  key={cat}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setCategory(cat)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{cat}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Price</Text>
          <TextInput
            style={styles.input}
            value={price}
            onChangeText={setPrice}
            placeholder="$45"
            placeholderTextColor={SellerTheme.textSecondary}
            keyboardType="default"
          />

          <Text style={styles.label}>SKU {isEdit ? '' : '(leave empty to auto-generate)'}</Text>
          <TextInput
            style={styles.input}
            value={sku}
            onChangeText={setSku}
            placeholder="Auto if empty"
            placeholderTextColor={SellerTheme.textSecondary}
            autoCapitalize="characters"
          />

          <Text style={styles.label}>Description / specs</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={description}
            onChangeText={setDescription}
            placeholder="Short product details"
            placeholderTextColor={SellerTheme.textSecondary}
            multiline
            textAlignVertical="top"
          />

          <Text style={styles.label}>{categoryHint(category)}</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={categoryNotes}
            onChangeText={setCategoryNotes}
            placeholder="Optional free text"
            placeholderTextColor={SellerTheme.textSecondary}
            multiline
            textAlignVertical="top"
          />

          <Text style={styles.label}>Stock / quantity</Text>
          <TextInput
            style={styles.input}
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="number-pad"
            placeholder="10"
            placeholderTextColor={SellerTheme.textSecondary}
          />

          <Text style={styles.label}>Status</Text>
          <View style={styles.chips}>
            {(['active', 'draft'] as const).map((s) => {
              const active = status === s;
              return (
                <TouchableOpacity
                  key={s}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setStatus(s)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {s === 'active' ? 'Active' : 'Draft'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={[styles.saveButton, saving && { opacity: 0.6 }]}
            onPress={onSave}
            disabled={saving}
          >
            <Text style={styles.saveButtonText}>
              {isEdit ? 'Update product' : 'List product'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: SellerTheme.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SellerTheme.border,
  },
  headerBtn: {
    padding: 6,
    minWidth: 56,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: SellerTheme.text,
    fontSize: 17,
    fontWeight: '700',
  },
  saveText: {
    color: SellerTheme.accent,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
  },
  form: {
    padding: 16,
    paddingBottom: 48,
  },
  photoBlock: {
    alignItems: 'center',
    marginBottom: 20,
  },
  photo: {
    width: 120,
    height: 120,
    borderRadius: 16,
    backgroundColor: SellerTheme.surface,
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  photoHint: {
    color: SellerTheme.textSecondary,
    fontSize: 12,
  },
  photoActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  photoActionText: {
    color: SellerTheme.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  label: {
    color: SellerTheme.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 4,
  },
  input: {
    backgroundColor: SellerTheme.surface,
    borderRadius: SellerTheme.radiusSm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: SellerTheme.text,
    fontSize: 16,
    marginBottom: 14,
  },
  textarea: {
    minHeight: 88,
    paddingTop: 12,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: SellerTheme.chipIdle,
  },
  chipActive: {
    backgroundColor: SellerTheme.chipActive,
  },
  chipText: {
    color: SellerTheme.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  chipTextActive: {
    color: SellerTheme.chipActiveText,
  },
  saveButton: {
    marginTop: 12,
    backgroundColor: SellerTheme.chipActive,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveButtonText: {
    color: SellerTheme.chipActiveText,
    fontSize: 16,
    fontWeight: '700',
  },
});
