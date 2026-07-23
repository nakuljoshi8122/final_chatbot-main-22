import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SellerTheme, InventoryStatus } from '@/shared/theme/SellerTheme';
import { useStore } from '@/features/legacy-store/context/StoreContext';
import {
  InventoryItem,
  loadInventory,
  permanentlyDeleteInventoryItem,
  pushSellerListingsToChat,
  setItemQuantity,
  setItemStatus,
} from '@/services/inventoryStore';
import { GlassPane, GlassPill, GlassScreen } from '@/shared/ui/Glass';
import { Glass } from '@/shared/theme/LiquidGlass';

const FILTERS: { key: InventoryStatus; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'draft', label: 'Draft' },
  { key: 'trash', label: 'Trash' },
];

function rowSubtext(item: InventoryItem): string {
  if (item.quantity <= 0) return 'Out of stock';
  return `${item.quantity} in stock · ${item.category}`;
}

export default function InventoryScreen() {
  const router = useRouter();
  const { store } = useStore();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<InventoryStatus>('active');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadInventory();
      setItems(next);
      setSelected((prev) => (prev ? next.find((i) => i.id === prev.id) ?? null : null));
      // Push locally listed seller items so chat search can find them
      void pushSellerListingsToChat();
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (store && item.category !== store.category) return false;
      if (item.status !== filter) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [items, filter, search, store]);

  const openAdd = () => {
    router.push({
      pathname: '/inventory/edit',
      params: store ? { category: store.category } : {},
    });
  };

  const openEdit = (item: InventoryItem) => {
    setMoreOpen(false);
    setSelected(null);
    router.push({ pathname: '/inventory/edit', params: { id: item.id } });
  };

  const onChangeQty = async (delta: number) => {
    if (!selected) return;
    const nextQty = Math.max(0, selected.quantity + delta);
    const updated = await setItemQuantity(selected.id, nextQty);
    if (!updated) return;
    setSelected(updated);
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  };

  const moveStatus = async (status: InventoryStatus) => {
    if (!selected) return;
    const updated = await setItemStatus(selected.id, status);
    setMoreOpen(false);
    setSelected(null);
    if (updated) {
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    }
  };

  const confirmDelete = () => {
    if (!selected) return;
    Alert.alert('Move to Trash', `Delete “${selected.name}”? You can restore it from Trash.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Move to Trash',
        style: 'destructive',
        onPress: () => moveStatus('trash'),
      },
    ]);
  };

  const confirmPermanentDelete = () => {
    if (!selected) return;
    Alert.alert(
      'Permanently delete?',
      `This erases “${selected.name}” completely (listing, image, and catalog data). This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Permanently Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const id = selected.id;
              await permanentlyDeleteInventoryItem(id);
              setMoreOpen(false);
              setSelected(null);
              setItems((prev) => prev.filter((i) => i.id !== id));
            })();
          },
        },
      ],
    );
  };

  const renderRow = ({ item }: { item: InventoryItem }) => (
    <TouchableOpacity
      onPress={() => {
        setSelected(item);
        setMoreOpen(false);
      }}
      activeOpacity={0.7}
    >
      <GlassPane scheme="light" intensity="regular" noBlur flat style={styles.row} contentStyle={styles.rowContent}>
      {item.imageUri ? (
        <Image source={{ uri: item.imageUri }} style={styles.thumb} contentFit="cover" />
      ) : (
        <View style={[styles.thumb, styles.thumbFallback]}>
          <Ionicons name="image-outline" size={20} color={SellerTheme.textSecondary} />
        </View>
      )}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {rowSubtext(item)}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={SellerTheme.textSecondary} />
      </GlassPane>
    </TouchableOpacity>
  );

  return (
    <GlassScreen scheme="light">
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <GlassPane scheme="light" intensity="regular" radius={0} flat contentStyle={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={SellerTheme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Inventory</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={openAdd} hitSlop={10} style={styles.headerBtn}>
            <View style={styles.plusBox}>
              <Ionicons name="add" size={20} color={SellerTheme.text} />
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setSearchOpen((v) => !v)}
            hitSlop={10}
            style={styles.headerBtn}
          >
            <Ionicons name="search" size={22} color={SellerTheme.text} />
          </TouchableOpacity>
        </View>
      </GlassPane>

      {searchOpen && (
        <View style={styles.searchWrap}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search products"
            placeholderTextColor={SellerTheme.textSecondary}
            style={styles.searchInput}
            autoFocus
          />
        </View>
      )}

      <View style={styles.chips}>
        {FILTERS.map((chip) => {
          const active = filter === chip.key;
          return (
            <TouchableOpacity
              key={chip.key}
              onPress={() => setFilter(chip.key)}
            >
              <GlassPill scheme="light" active={active} style={styles.chip}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{chip.label}</Text>
              </GlassPill>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={SellerTheme.textSecondary} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          renderItem={renderRow}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <Text style={styles.empty}>No products in {filter}.</Text>
          }
        />
      )}

      <Modal
        visible={!!selected}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setMoreOpen(false);
          setSelected(null);
        }}
      >
        <Pressable
          style={styles.sheetOverlay}
          onPress={() => {
            setMoreOpen(false);
            setSelected(null);
          }}
        />
        <GlassPane scheme="light" intensity="strong" radius={Glass.radius.lg} style={styles.sheet} contentStyle={styles.sheetContent}>
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              onPress={() => {
                setMoreOpen(false);
                setSelected(null);
              }}
              hitSlop={12}
            >
              <Ionicons name="close" size={24} color={SellerTheme.text} />
            </TouchableOpacity>
          </View>

          {selected && (
            <>
              {selected.imageUri ? (
                <Image
                  source={{ uri: selected.imageUri }}
                  style={styles.heroImage}
                  contentFit="cover"
                />
              ) : (
                <View style={[styles.heroImage, styles.thumbFallback]}>
                  <Ionicons name="image-outline" size={40} color={SellerTheme.textSecondary} />
                </View>
              )}
              <Text style={styles.sellerName}>{SellerTheme.sellerName}</Text>
              <Text style={styles.productName}>{selected.name}</Text>

              <View style={styles.actionsRow}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => openEdit(selected)}>
                  <Text style={styles.actionBtnText}>Edit product</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() =>
                    Alert.alert(
                      selected.name,
                      `${selected.price || 'Price n/a'}\nSKU: ${selected.sku}\n${selected.description || ''}`,
                    )
                  }
                >
                  <Text style={styles.actionBtnText}>View</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.moreBtn]}
                  onPress={() => setMoreOpen((v) => !v)}
                >
                  <Ionicons name="ellipsis-horizontal" size={18} color={SellerTheme.text} />
                </TouchableOpacity>
              </View>

              {moreOpen && (
                <View style={styles.moreMenu}>
                  <TouchableOpacity style={styles.moreItem} onPress={() => openEdit(selected)}>
                    <Text style={styles.moreItemText}>Edit</Text>
                  </TouchableOpacity>
                  {selected.status === 'trash' ? (
                    <>
                      <TouchableOpacity
                        style={styles.moreItem}
                        onPress={() => moveStatus('active')}
                      >
                        <Text style={styles.moreItemText}>Restore Item</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.moreItem}
                        onPress={confirmPermanentDelete}
                      >
                        <Text style={[styles.moreItemText, styles.dangerText]}>
                          Permanently Delete
                        </Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity style={styles.moreItem} onPress={confirmDelete}>
                      <Text style={[styles.moreItemText, styles.dangerText]}>
                        Move to Trash
                      </Text>
                    </TouchableOpacity>
                  )}
                  {selected.status === 'draft' && (
                    <TouchableOpacity
                      style={styles.moreItem}
                      onPress={() => moveStatus('active')}
                    >
                      <Text style={styles.moreItemText}>Publish (Active)</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              <View style={styles.variantRow}>
                {selected.imageUri ? (
                  <Image
                    source={{ uri: selected.imageUri }}
                    style={styles.variantThumb}
                    contentFit="cover"
                  />
                ) : (
                  <View style={[styles.variantThumb, styles.thumbFallback]} />
                )}
                <Text style={styles.variantLabel}>Variant</Text>
                <View style={styles.stepper}>
                  <TouchableOpacity style={styles.stepBtn} onPress={() => onChangeQty(-1)}>
                    <Ionicons name="remove" size={18} color={SellerTheme.text} />
                  </TouchableOpacity>
                  <View style={styles.qtyPill}>
                    <Text style={styles.qtyText}>{selected.quantity}</Text>
                  </View>
                  <TouchableOpacity style={styles.stepBtn} onPress={() => onChangeQty(1)}>
                    <Ionicons name="add" size={18} color={SellerTheme.text} />
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}
        </GlassPane>
      </Modal>
    </SafeAreaView>
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  headerBtn: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: SellerTheme.text,
    fontSize: 18,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  plusBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: SellerTheme.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrap: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  searchInput: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: Glass.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SellerTheme.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: SellerTheme.text,
    fontSize: 15,
  },
  chips: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 12,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipText: {
    color: SellerTheme.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  chipTextActive: {
    color: SellerTheme.chipActiveText,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 40,
  },
  row: {
    marginBottom: 8,
    borderRadius: Glass.radius.md,
  },
  rowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: SellerTheme.surface,
  },
  thumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  rowTitle: {
    color: SellerTheme.text,
    fontSize: 16,
    fontWeight: '600',
  },
  rowSub: {
    color: SellerTheme.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  empty: {
    color: SellerTheme.textSecondary,
    textAlign: 'center',
    marginTop: 48,
    fontSize: 15,
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: SellerTheme.overlay,
  },
  sheet: {
    borderTopLeftRadius: Glass.radius.lg,
    borderTopRightRadius: Glass.radius.lg,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    maxHeight: '72%',
  },
  sheetContent: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  sheetHeader: {
    flexDirection: 'row',
    paddingTop: 14,
    marginBottom: 8,
  },
  heroImage: {
    width: 120,
    height: 120,
    borderRadius: 16,
    alignSelf: 'center',
    backgroundColor: SellerTheme.surfaceElevated,
    marginBottom: 14,
  },
  sellerName: {
    color: SellerTheme.text,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  productName: {
    color: SellerTheme.textSecondary,
    fontSize: 15,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
  },
  actionBtn: {
    backgroundColor: SellerTheme.surfaceElevated,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
  },
  moreBtn: {
    paddingHorizontal: 12,
  },
  actionBtnText: {
    color: SellerTheme.text,
    fontSize: 14,
    fontWeight: '600',
  },
  moreMenu: {
    backgroundColor: SellerTheme.surfaceElevated,
    borderRadius: SellerTheme.radiusSm,
    marginBottom: 12,
    overflow: 'hidden',
  },
  moreItem: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SellerTheme.border,
  },
  moreItemText: {
    color: SellerTheme.text,
    fontSize: 15,
  },
  dangerText: {
    color: SellerTheme.danger,
  },
  variantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: SellerTheme.border,
  },
  variantThumb: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: SellerTheme.surfaceElevated,
  },
  variantLabel: {
    flex: 1,
    marginLeft: 12,
    color: SellerTheme.text,
    fontSize: 15,
    fontWeight: '500',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: SellerTheme.stepperBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyPill: {
    minWidth: 44,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: SellerTheme.chipActive,
    alignItems: 'center',
  },
  qtyText: {
    color: SellerTheme.chipActiveText,
    fontWeight: '700',
    fontSize: 15,
  },
});
