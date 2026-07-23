import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Pressable,
  Alert,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import { SellerTheme, InventoryStatus, SellerCategory } from '@/shared/theme/SellerTheme';
import { fetchStoreProducts } from '@/services/storesApi';
import { patchSellerProduct } from '@/services/patchSellerProduct';
import UndoToast from '@/shared/ui/UndoToast';
import {
  appendChangeLog,
  loadChangeLog,
  loadStoreSettings,
  saveStoreSettings,
  ChangeLogEntry,
  bumpSoldOutHit,
} from '@/services/sellerLazyStore';
import { tapHaptic, successHaptic, warnHaptic } from '@/shared/utils/sellerHaptics';
import { createInventoryItem } from '@/services/inventoryStore';
import { getProductDiscount, withDollar } from '@/shared/utils/productDiscount';
import { GlassPane, GlassPill } from '@/shared/ui/Glass';
import { Glass } from '@/shared/theme/LiquidGlass';

const FILTERS: { key: InventoryStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'draft', label: 'Draft' },
  { key: 'trash', label: 'Trash' },
];

type Row = {
  sku: string;
  name: string;
  category?: string;
  price?: string;
  list_price?: string;
  quantity?: number;
  status?: string;
  img?: string;
  description?: string;
};

type UndoState = {
  message: string;
  apply: () => Promise<void>;
};

function priceDigits(p?: string) {
  return String(p || '')
    .replace(/^\$/, '')
    .trim();
}

export default function SellerInventoryScreen() {
  const { storeId } = useLocalSearchParams<{ storeId: string }>();
  const router = useRouter();
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<InventoryStatus | 'all'>('all');
  const [editingPriceSku, setEditingPriceSku] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState('');
  const [busySku, setBusySku] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lowOnly, setLowOnly] = useState(false);
  const [log, setLog] = useState<ChangeLogEntry[]>([]);
  const [autoDraftSoldOut, setAutoDraftSoldOut] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const swipeRefs = useRef<Map<string, Swipeable | null>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, settings, changelog] = await Promise.all([
        fetchStoreProducts(String(storeId), false),
        loadStoreSettings(String(storeId)),
        loadChangeLog(String(storeId)),
      ]);
      setItems(rows as Row[]);
      setAutoDraftSoldOut(!!settings.autoDraftSoldOut);
      setLog(changelog.slice(0, 5));
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const visible = useMemo(() => {
    const normalized = (s?: string) => (s === 'archive' ? 'draft' : s || 'active');
    let list =
      filter === 'all'
        ? items.filter((i) => {
            const st = normalized(i.status);
            return st === 'active' || st === 'draft' || st === 'trash';
          })
        : items.filter((i) => normalized(i.status) === filter);
    if (lowOnly) {
      list = list.filter((i) => (i.quantity ?? 0) < 3 && normalized(i.status) === 'active');
    }
    return list;
  }, [items, filter, lowOnly]);

  const toggleSelect = (sku: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  };

  const selectedItems = useMemo(
    () => visible.filter((i) => selected.has(i.sku)),
    [visible, selected],
  );

  const patchRow = async (
    item: Row,
    patch: {
      quantity?: number;
      price?: string;
      list_price?: string;
      clear_discount?: boolean;
      status?: string;
    },
    undoMessage: string,
    previous: { quantity?: number; price?: string; list_price?: string; status?: string },
  ) => {
    setBusySku(item.sku);
    const nextQty = patch.quantity ?? item.quantity ?? 0;
    const nextPrice = patch.price ?? item.price;
    const clearDiscount =
      patch.clear_discount ??
      (patch.price !== undefined && patch.list_price === undefined);
    const nextListPrice =
      patch.list_price !== undefined
        ? patch.list_price
        : clearDiscount
          ? ''
          : item.list_price;
    const nextStatus = patch.status ?? item.status ?? 'active';

    // Optimistic UI
    setItems((prev) =>
      prev.map((r) =>
        r.sku === item.sku
          ? {
              ...r,
              quantity: nextQty,
              price: nextPrice,
              list_price: nextListPrice,
              status: nextStatus,
            }
          : r,
      ),
    );

    const ok = await patchSellerProduct({
      sku: item.sku,
      name: item.name,
      store_id: String(storeId),
      category: item.category,
      description: item.description,
      img: item.img,
      quantity: nextQty,
      price: nextPrice?.startsWith('$') ? nextPrice : nextPrice ? `$${nextPrice}` : undefined,
      list_price:
        patch.list_price !== undefined ? patch.list_price : clearDiscount ? '' : undefined,
      clear_discount: clearDiscount,
      status: nextStatus,
    });
    setBusySku(null);

    if (!ok) {
      setItems((prev) =>
        prev.map((r) =>
          r.sku === item.sku
            ? {
                ...r,
                quantity: previous.quantity ?? item.quantity,
                price: previous.price ?? item.price,
                list_price:
                  previous.list_price !== undefined ? previous.list_price : item.list_price,
                status: previous.status ?? item.status,
              }
            : r,
        ),
      );
      setUndo({ message: 'Save failed', apply: async () => undefined });
      return;
    }

    tapHaptic();
    void appendChangeLog(String(storeId), undoMessage, item.sku);
    void loadChangeLog(String(storeId)).then((l) => setLog(l.slice(0, 5)));

    // Tier 12: auto-draft when sold out
    if (autoDraftSoldOut && nextQty === 0 && nextStatus === 'active') {
      await patchSellerProduct({
        sku: item.sku,
        name: item.name,
        store_id: String(storeId),
        category: item.category,
        description: item.description,
        img: item.img,
        quantity: 0,
        price: nextPrice,
        status: 'draft',
      });
      setItems((prev) =>
        prev.map((r) => (r.sku === item.sku ? { ...r, status: 'draft' } : r)),
      );
      void appendChangeLog(String(storeId), `${item.name} auto-drafted (sold out)`, item.sku);
    }

    if (nextQty === 0 && (item.quantity ?? 0) > 0) {
      void bumpSoldOutHit(String(storeId), item.sku);
    }

    setUndo({
      message: undoMessage,
      apply: async () => {
        setBusySku(item.sku);
        await patchSellerProduct({
          sku: item.sku,
          name: item.name,
          store_id: String(storeId),
          category: item.category,
          description: item.description,
          img: item.img,
          quantity: previous.quantity ?? item.quantity ?? 0,
          price: previous.price,
          list_price: previous.list_price,
          status: previous.status ?? item.status,
        });
        setItems((prev) =>
          prev.map((r) =>
            r.sku === item.sku
              ? {
                  ...r,
                  quantity: previous.quantity ?? item.quantity,
                  price: previous.price ?? item.price,
                  list_price:
                    previous.list_price !== undefined ? previous.list_price : item.list_price,
                  status: previous.status ?? item.status,
                }
              : r,
          ),
        );
        setBusySku(null);
      },
    });
  };

  const bumpQty = (item: Row, delta: number) => {
    const cur = item.quantity ?? 0;
    const next = Math.max(0, cur + delta);
    if (next === cur) return;
    void patchRow(
      item,
      { quantity: next },
      `Stock → ${next}`,
      { quantity: cur, price: item.price, status: item.status },
    );
  };

  const setStatus = (item: Row, status: 'active' | 'draft') => {
    if ((item.status || 'active') === status) return;
    void patchRow(
      item,
      { status },
      status === 'active' ? 'Published' : 'Moved to draft',
      { quantity: item.quantity, price: item.price, status: item.status },
    );
  };

  const savePrice = (item: Row) => {
    const cleaned = priceDraft.replace(/[^\d.]/g, '');
    if (!cleaned) {
      setEditingPriceSku(null);
      return;
    }
    const discount = getProductDiscount(item.price, item.list_price);
    const oldN = parseFloat(priceDigits(discount ? item.list_price : item.price));
    const newN = parseFloat(cleaned);
    const drop = oldN > 0 ? (oldN - newN) / oldN : 0;
    const apply = () => {
      const formatted = `$${cleaned}`;
      void patchRow(
        item,
        { price: formatted, list_price: '', clear_discount: true },
        `Price → ${formatted}`,
        {
          quantity: item.quantity,
          price: item.price,
          list_price: item.list_price,
          status: item.status,
        },
      );
      setEditingPriceSku(null);
    };
    if (drop > 0.3) {
      warnHaptic();
      Alert.alert(
        'Big price drop',
        `Drop ${Math.round(drop * 100)}% from $${oldN.toFixed(2)} to $${newN.toFixed(2)}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Confirm', style: 'destructive', onPress: apply },
        ],
      );
      return;
    }
    apply();
  };

  const renderRightActions = (item: Row) => (
    <TouchableOpacity
      style={styles.swipeDraft}
      onPress={() => {
        swipeRefs.current.get(item.sku)?.close();
        setStatus(item, 'draft');
      }}
    >
      <Ionicons name="document-outline" size={20} color="#fff" />
      <Text style={styles.swipeText}>Draft</Text>
    </TouchableOpacity>
  );

  const renderLeftActions = (item: Row) => (
    <TouchableOpacity
      style={styles.swipePlus}
      onPress={() => {
        swipeRefs.current.get(item.sku)?.close();
        bumpQty(item, 1);
      }}
    >
      <Ionicons name="add" size={22} color="#fff" />
      <Text style={styles.swipeText}>+1</Text>
    </TouchableOpacity>
  );

  const bulkOnSelected = async (
    action: 'plus5' | 'to10' | 'draft' | 'publish' | 'trash',
  ) => {
    const targets = selectedItems.filter((i) => (i.status || 'active') !== 'trash');
    if (!targets.length) return;

    if (action === 'trash' || action === 'publish') {
      warnHaptic();
      const label =
        action === 'trash'
          ? `Move ${targets.length} to trash?`
          : `Publish ${targets.length} items?`;
      Alert.alert('Confirm', label, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes',
          style: action === 'trash' ? 'destructive' : 'default',
          onPress: () => void runBulk(targets, action),
        },
      ]);
      return;
    }
    await runBulk(targets, action);
  };

  const runBulk = async (
    targets: Row[],
    action: 'plus5' | 'to10' | 'draft' | 'publish' | 'trash',
  ) => {
    for (const item of targets) {
      if (action === 'plus5') bumpQty(item, 5);
      else if (action === 'to10') {
        const cur = item.quantity ?? 0;
        if (cur < 10) {
          void patchRow(
            item,
            { quantity: 10 },
            `Stock → 10`,
            { quantity: cur, price: item.price, status: item.status },
          );
        }
      } else if (action === 'draft') setStatus(item, 'draft');
      else if (action === 'publish') setStatus(item, 'active');
      else if (action === 'trash') {
        void patchRow(
          item,
          { status: 'trash' },
          'Moved to trash',
          { quantity: item.quantity, price: item.price, status: item.status },
        );
      }
    }
    successHaptic();
    setSelectMode(false);
    setSelected(new Set());
  };

  const priceRewriteVisible = () => {
    const targets = lowOnly ? visible : selectedItems.length ? selectedItems : visible;
    if (!targets.length) return;
    Alert.alert('Price rewrite', 'Apply to visible/selected items', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: '+10%',
        onPress: () => void applyPricePct(targets, 1.1),
      },
      {
        text: '−30%',
        onPress: () => void applyPricePct(targets, 0.7),
      },
      {
        text: 'Round .99',
        onPress: () => void applyPriceRound(targets),
      },
    ]);
  };

  const applyPricePct = async (targets: Row[], mult: number) => {
    const applyAll = () => {
      for (const item of targets) {
        const n = parseFloat(priceDigits(item.price));
        if (!n) continue;
        const next = `$${(n * mult).toFixed(2)}`;
        void patchRow(
          item,
          { price: next },
          `Price → ${next}`,
          { quantity: item.quantity, price: item.price, status: item.status },
        );
      }
    };
    if (mult < 0.7) {
      warnHaptic();
      Alert.alert(
        'Big price drop',
        `Cut prices by ${Math.round((1 - mult) * 100)}% on ${targets.length} items?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Confirm', style: 'destructive', onPress: applyAll },
        ],
      );
      return;
    }
    warnHaptic();
    applyAll();
  };

  const applyPriceRound = async (targets: Row[]) => {
    for (const item of targets) {
      const n = parseFloat(priceDigits(item.price));
      if (!n) continue;
      const rounded = Math.floor(n) + 0.99;
      const next = `$${rounded.toFixed(2)}`;
      void patchRow(
        item,
        { price: next },
        `Price → ${next}`,
        { quantity: item.quantity, price: item.price, status: item.status },
      );
    }
  };

  const cloneVariants = async (item: Row) => {
    Alert.alert('Clone aisle', `Make variants of "${item.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: '3 variants',
        onPress: async () => {
          const suffixes = [' — S', ' — M', ' — L'];
          for (const s of suffixes) {
            await createInventoryItem({
              name: `${item.name}${s}`,
              price: item.price || '$0',
              category: (item.category as SellerCategory) || 'Handicrafts',
              quantity: item.quantity ?? 5,
              description: item.description || '',
              categoryNotes: '',
              status: 'draft',
              imageUri: item.img,
              storeId: String(storeId),
            });
          }
          successHaptic();
          setUndo({ message: '3 variants created as drafts', apply: async () => undefined });
          void load();
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
          keyboardShouldPersistTaps="handled"
        >
          {FILTERS.map((f) => (
            <TouchableOpacity key={f.key} onPress={() => setFilter(f.key)}>
              <GlassPill
                scheme="light"
                active={filter === f.key}
                activeColor={SellerTheme.chipActive}
                style={styles.chip}
              >
                <Text style={[styles.chipText, filter === f.key && styles.chipTextOn]}>
                  {f.label}
                </Text>
              </GlassPill>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={() => setLowOnly((v) => !v)}>
            <GlassPill
              scheme="light"
              active={lowOnly}
              activeColor={SellerTheme.chipActive}
              style={styles.chip}
            >
              <Text style={[styles.chipText, lowOnly && styles.chipTextOn]}>Low</Text>
            </GlassPill>
          </TouchableOpacity>
        </ScrollView>
        <View style={styles.toolbarActions}>
          <TouchableOpacity
            onPress={() => {
              setSelectMode((v) => !v);
              setSelected(new Set());
            }}
            hitSlop={8}
            style={styles.iconAction}
          >
            <Ionicons
              name={selectMode ? 'checkmark-done' : 'checkbox-outline'}
              size={20}
              color={selectMode ? Glass.tint.blue : SellerTheme.text}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setShowTools((v) => !v)}
            hitSlop={8}
            style={styles.iconAction}
          >
            <Ionicons
              name="options-outline"
              size={20}
              color={showTools ? Glass.tint.blue : SellerTheme.text}
            />
          </TouchableOpacity>
        </View>
      </View>

      {showTools ? (
        <View style={styles.toolsPanel}>
          <View style={styles.toolRow}>
            {lowOnly ? (
              <TouchableOpacity
                onPress={() => {
                  visible.forEach((i) => bumpQty(i, 5));
                  successHaptic();
                }}
              >
                <GlassPill scheme="light" style={styles.toolBtn}>
                  <Text style={styles.toolBtnText}>Restock visible +5</Text>
                </GlassPill>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={priceRewriteVisible}>
              <GlassPill scheme="light" style={styles.toolBtn}>
                <Text style={styles.toolBtnText}>Price rewrite</Text>
              </GlassPill>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => {
                const next = !autoDraftSoldOut;
                setAutoDraftSoldOut(next);
                await saveStoreSettings(String(storeId), { autoDraftSoldOut: next });
                setUndo({
                  message: next ? 'Auto-draft sold-out ON' : 'Auto-draft sold-out OFF',
                  apply: async () => undefined,
                });
              }}
            >
              <GlassPill scheme="light" active={autoDraftSoldOut} style={styles.toolBtn}>
                <Text
                  style={[styles.toolBtnText, autoDraftSoldOut && styles.toolBtnTextOn]}
                >
                  {autoDraftSoldOut ? 'Auto-draft ✓' : 'Auto-draft'}
                </Text>
              </GlassPill>
            </TouchableOpacity>
          </View>
          {log.length ? (
            <View style={styles.logStrip}>
              <Text style={styles.logTitle}>Recent</Text>
              {log.slice(0, 3).map((e) => (
                <Text key={e.id} style={styles.logLine} numberOfLines={1}>
                  {e.label}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {selectMode && selected.size > 0 ? (
        <View style={styles.bulkBar}>
          <TouchableOpacity onPress={() => void bulkOnSelected('plus5')}>
            <Text style={styles.bulkBarText}>+5</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => void bulkOnSelected('to10')}>
            <Text style={styles.bulkBarText}>→10</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => void bulkOnSelected('draft')}>
            <Text style={styles.bulkBarText}>Draft</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => void bulkOnSelected('publish')}>
            <Text style={styles.bulkBarText}>Publish</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => void bulkOnSelected('trash')}>
            <Text style={[styles.bulkBarText, { color: Glass.tint.red }]}>Trash</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={Glass.ink.light} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.sku}
          contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="cube-outline" size={36} color={SellerTheme.textSecondary} />
              <Text style={styles.empty}>Nothing here yet</Text>
              <TouchableOpacity
                style={styles.emptyCta}
                onPress={() =>
                  router.replace(`/seller/${storeId}?openAdd=1` as never)
                }
              >
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.emptyCtaText}>Add product</Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => {
            const st = item.status === 'archive' ? 'draft' : item.status || 'active';
            const low = (item.quantity ?? 0) <= 2;
            const discount = getProductDiscount(item.price, item.list_price);
            return (
              <Swipeable
                ref={(r) => {
                  swipeRefs.current.set(item.sku, r);
                }}
                renderLeftActions={() =>
                  st !== 'trash' ? renderLeftActions(item) : null
                }
                renderRightActions={() =>
                  st === 'active' ? renderRightActions(item) : null
                }
                overshootLeft={false}
                overshootRight={false}
              >
                <GlassPane
                  scheme="light"
                  intensity="regular"
                  noBlur
                  flat
                  style={[styles.row, low && st === 'active' && styles.rowLow]}
                  contentStyle={styles.rowContent}
                >
                  {selectMode ? (
                    <TouchableOpacity
                      style={styles.check}
                      onPress={() => toggleSelect(item.sku)}
                    >
                      <Ionicons
                        name={selected.has(item.sku) ? 'checkbox' : 'square-outline'}
                        size={22}
                        color={SellerTheme.text}
                      />
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={styles.thumbWrap}
                    onPress={() =>
                      selectMode
                        ? toggleSelect(item.sku)
                        : router.push({
                            pathname: '/inventory/edit',
                            params: { id: item.sku, storeId: String(storeId) },
                          })
                    }
                  >
                    {item.img ? (
                      <Image source={{ uri: item.img }} style={styles.thumb} />
                    ) : (
                      <View style={[styles.thumb, styles.thumbPh]} />
                    )}
                    {discount ? (
                      <View style={styles.discountBadge}>
                        <Text style={styles.discountBadgeText}>{discount.percentOff}%</Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>

                  <View style={styles.meta}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.name}
                    </Text>

                    {editingPriceSku === item.sku ? (
                      <View style={styles.priceEdit}>
                        <Text style={styles.dollar}>$</Text>
                        <TextInput
                          style={styles.priceInput}
                          value={priceDraft}
                          onChangeText={(t) => setPriceDraft(t.replace(/[^\d.]/g, ''))}
                          keyboardType="decimal-pad"
                          autoFocus
                          onSubmitEditing={() => savePrice(item)}
                        />
                        <Pressable onPress={() => savePrice(item)}>
                          <Text style={styles.priceSave}>Save</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <TouchableOpacity
                        onPress={() => {
                          setEditingPriceSku(item.sku);
                          setPriceDraft(
                            priceDigits(discount ? item.list_price : item.price),
                          );
                        }}
                      >
                        {discount ? (
                          <View style={styles.discountPriceRow}>
                            <Text style={styles.originalPrice}>
                              {withDollar(item.list_price)}
                            </Text>
                            <Text style={styles.price}>{withDollar(item.price)}</Text>
                          </View>
                        ) : (
                          <Text style={styles.price}>
                            {item.price ? withDollar(item.price) : 'Tap to set price'}
                          </Text>
                        )}
                      </TouchableOpacity>
                    )}

                    {st !== 'trash' ? (
                      <View style={styles.controls}>
                        <View style={styles.stepper}>
                          <TouchableOpacity
                            style={styles.stepBtn}
                            onPress={() => bumpQty(item, -1)}
                            disabled={busySku === item.sku}
                          >
                            <Ionicons name="remove" size={14} color={SellerTheme.text} />
                          </TouchableOpacity>
                          <Text style={styles.qty}>{item.quantity ?? 0}</Text>
                          <TouchableOpacity
                            style={styles.stepBtn}
                            onPress={() => bumpQty(item, 1)}
                            disabled={busySku === item.sku}
                          >
                            <Ionicons name="add" size={14} color={SellerTheme.text} />
                          </TouchableOpacity>
                          {(item.quantity ?? 0) === 0 ? (
                            <TouchableOpacity
                              style={styles.restock10}
                              onPress={() => bumpQty(item, 10)}
                            >
                              <Text style={styles.restock10Text}>→10</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>

                        <View style={styles.statusRow}>
                          <TouchableOpacity
                            onPress={() => setStatus(item, 'active')}
                          >
                            <GlassPill
                              scheme="light"
                              active={st === 'active'}
                              activeColor={SellerTheme.chipActive}
                              style={styles.statusChip}
                            >
                              <Text
                                style={[
                                  styles.statusChipText,
                                  st === 'active' && styles.statusOnText,
                                ]}
                              >
                                Active
                              </Text>
                            </GlassPill>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => setStatus(item, 'draft')}
                          >
                            <GlassPill
                              scheme="light"
                              active={st === 'draft'}
                              activeColor={SellerTheme.chipActive}
                              style={styles.statusChip}
                            >
                              <Text
                                style={[
                                  styles.statusChipText,
                                  st === 'draft' && styles.statusOnText,
                                ]}
                              >
                                Draft
                              </Text>
                            </GlassPill>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => void cloneVariants(item)}
                          >
                            <GlassPill scheme="light" style={styles.statusChip}>
                              <Text style={styles.statusChipText}>Clone</Text>
                            </GlassPill>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <Text style={styles.sub}>In trash</Text>
                    )}
                  </View>
                </GlassPane>
              </Swipeable>
            );
          }}
        />
      )}

      <TouchableOpacity
        style={styles.addFab}
        onPress={() => router.replace(`/seller/${storeId}?openAdd=1` as never)}
        activeOpacity={0.85}
        accessibilityLabel="Add product"
      >
        <Ionicons name="add" size={26} color="#fff" />
      </TouchableOpacity>

      <UndoToast
        message={undo?.message ?? null}
        onUndo={undo ? () => void undo.apply() : undefined}
        onDismiss={() => setUndo(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 8,
    paddingRight: 4,
    paddingTop: 4,
    gap: 4,
  },
  filters: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  toolbarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingRight: 6,
  },
  iconAction: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolsPanel: {
    paddingBottom: 4,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Glass.radius.pill,
  },
  chipText: { color: SellerTheme.text, fontSize: 12, fontWeight: '600' },
  chipTextOn: { color: SellerTheme.chipActiveText },
  emptyWrap: { alignItems: 'center', marginTop: 48, gap: 10, paddingHorizontal: 24 },
  empty: { color: SellerTheme.textSecondary, textAlign: 'center', fontSize: 15 },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Glass.tint.blue,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: Glass.radius.pill,
    marginTop: 8,
  },
  emptyCtaText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  addFab: {
    position: 'absolute',
    right: 18,
    bottom: 22,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Glass.tint.blue,
    alignItems: 'center',
    justifyContent: 'center',
    ...Glass.shadow,
  },
  row: {
    marginBottom: 10,
    borderRadius: Glass.radius.md,
  },
  rowContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 10,
    gap: 10,
  },
  rowLow: { borderColor: Glass.tint.red },
  thumbWrap: { position: 'relative' },
  thumb: { width: 56, height: 56, borderRadius: Glass.radius.sm },
  thumbPh: { backgroundColor: SellerTheme.surfaceElevated },
  discountBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: Glass.tint.red,
    borderRadius: 999,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  discountBadgeText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  meta: { flex: 1, gap: 4 },
  name: { color: SellerTheme.text, fontWeight: '700', fontSize: 15 },
  sub: { color: SellerTheme.textSecondary, fontSize: 12 },
  price: { color: Glass.tint.blue, fontSize: 14, fontWeight: '700' },
  discountPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  originalPrice: {
    color: Glass.tint.red,
    fontSize: 13,
    fontWeight: '700',
    textDecorationLine: 'line-through',
  },
  priceEdit: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dollar: { color: Glass.tint.blue, fontWeight: '800', fontSize: 14 },
  priceInput: {
    minWidth: 56,
    color: SellerTheme.text,
    fontWeight: '700',
    fontSize: 14,
    borderBottomWidth: 1,
    borderBottomColor: Glass.tint.blue,
    paddingVertical: 2,
  },
  priceSave: { color: Glass.tint.blue, fontWeight: '800', fontSize: 12, marginLeft: 6 },
  controls: { marginTop: 6, gap: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: SellerTheme.stepperBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SellerTheme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qty: {
    minWidth: 24,
    textAlign: 'center',
    color: SellerTheme.text,
    fontWeight: '800',
    fontSize: 15,
  },
  restock10: {
    marginLeft: 4,
    backgroundColor: Glass.tint.blue,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Glass.radius.pill,
  },
  restock10Text: { color: '#fff', fontWeight: '800', fontSize: 12 },
  statusRow: { flexDirection: 'row', gap: 6 },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Glass.radius.pill,
  },
  statusChipText: { color: SellerTheme.text, fontSize: 11, fontWeight: '700' },
  statusOnText: { color: SellerTheme.chipActiveText },
  swipePlus: {
    backgroundColor: Glass.tint.green,
    justifyContent: 'center',
    alignItems: 'center',
    width: 72,
    marginBottom: 10,
    borderRadius: Glass.radius.md,
    gap: 2,
  },
  swipeDraft: {
    backgroundColor: '#9A6B00',
    justifyContent: 'center',
    alignItems: 'center',
    width: 72,
    marginBottom: 10,
    borderRadius: Glass.radius.md,
    gap: 2,
  },
  swipeText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  toolRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  toolBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: Glass.radius.pill,
  },
  toolBtnText: { color: SellerTheme.text, fontWeight: '700', fontSize: 11 },
  toolBtnTextOn: { color: SellerTheme.chipActiveText },
  logStrip: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 8,
    backgroundColor: Glass.fill.light,
    borderRadius: Glass.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Glass.stroke.lightOuter,
    gap: 2,
  },
  logTitle: {
    color: SellerTheme.textSecondary,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  logLine: { color: SellerTheme.textSecondary, fontSize: 11 },
  bulkBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: Glass.fill.lightStrong,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: Glass.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Glass.stroke.lightOuter,
    paddingVertical: 10,
  },
  bulkBarText: { color: SellerTheme.text, fontWeight: '800', fontSize: 13 },
  check: { paddingTop: 16, paddingRight: 4 },
});
