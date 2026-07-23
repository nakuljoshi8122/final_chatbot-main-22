import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { TileProduct } from '@/shared/utils/parseTiles';
import { fetchSellerProduct, ApiSellerProduct } from '@/services/storesApi';
import { patchSellerProduct } from '@/services/patchSellerProduct';
import { fetchNotifyCount, broadcastNotify } from '@/services/notifyApi';
import { fetchAiPricing } from '@/services/sellerAiApi';
import {
  bumpSoldOutHit,
  getSoldOutHits,
  appendChangeLog,
} from '@/services/sellerLazyStore';
import { successHaptic, tapHaptic, warnHaptic } from '@/shared/utils/sellerHaptics';
import ProductImageGallery from '@/shared/ui/ProductImageGallery';
import { getProductDiscount } from '@/shared/utils/productDiscount';
import { GlassPane, GlassPill } from '@/shared/ui/Glass';
import { Glass } from '@/shared/theme/LiquidGlass';
import { SellerTheme } from '@/shared/theme/SellerTheme';

type Props = {
  product: TileProduct | null;
  storeId: string;
  storeName?: string;
  onClose: () => void;
  /** Called after a successful quick edit so the chat can refresh tiles. */
  onUpdated?: () => void;
};

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: 'rgba(52,199,123,0.20)', text: Glass.tint.green, label: 'Active' },
  draft: { bg: 'rgba(242,169,59,0.20)', text: Glass.tint.amber, label: 'Draft' },
  trash: { bg: 'rgba(255,90,95,0.20)', text: Glass.tint.red, label: 'Trash' },
};

const PROMO_RATE = 0.1;

function priceText(value?: string): string {
  const p = String(value || '').trim();
  if (!p) return '';
  return p.startsWith('$') ? p : `$${p}`;
}

function parsePriceNum(value?: string): number {
  const n = parseFloat(String(value || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function formatPriceNum(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  const rounded = Math.round(n * 100) / 100;
  return rounded % 1 === 0 ? String(Math.round(rounded)) : rounded.toFixed(2);
}

function saleFromList(list: number): number {
  return Math.round(list * (1 - PROMO_RATE) * 100) / 100;
}

export default function SellerTileDetailModal({
  product,
  storeId,
  storeName = '',
  onClose,
  onUpdated,
}: Props) {
  const router = useRouter();
  const [fresh, setFresh] = useState<ApiSellerProduct | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [qty, setQty] = useState(0);
  const [priceDraft, setPriceDraft] = useState('');
  const [listPriceDraft, setListPriceDraft] = useState('');
  const [salePriceDraft, setSalePriceDraft] = useState('');
  const [status, setStatus] = useState('active');
  const [descLocal, setDescLocal] = useState('');
  const [notifyCount, setNotifyCount] = useState(0);
  const [soldOutHits, setSoldOutHits] = useState(0);
  const [pricingTip, setPricingTip] = useState<string | null>(null);

  const sku = product?.sku || product?.id || '';

  useEffect(() => {
    if (!product) {
      setFresh(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const remote = await fetchSellerProduct(sku, storeId || undefined);
      if (cancelled) return;
      setFresh(remote);
      const q =
        typeof remote?.quantity === 'number'
          ? remote.quantity
          : typeof product.quantity === 'number'
            ? product.quantity
            : 0;
      setQty(q);
      const remotePrice = String(remote?.price || product.price || '')
        .replace(/^\$/, '')
        .trim();
      const remoteList = String((remote ? remote.list_price : product.list_price) || '')
        .replace(/^\$/, '')
        .trim();
      const remoteDesc = String(remote?.description ?? product.description ?? '');
      const legacyPromoDesc = /10%\s*off/i.test(remoteDesc);

      if (remoteList && parsePriceNum(remoteList) > parsePriceNum(remotePrice)) {
        setListPriceDraft(remoteList);
        setSalePriceDraft(remotePrice);
        setPriceDraft(remoteList);
      } else if (legacyPromoDesc && remotePrice) {
        const list = parsePriceNum(remotePrice);
        const sale = saleFromList(list);
        setListPriceDraft(formatPriceNum(list));
        setSalePriceDraft(formatPriceNum(sale));
        setPriceDraft(formatPriceNum(list));
      } else {
        setListPriceDraft('');
        setSalePriceDraft('');
        setPriceDraft(remotePrice);
      }
      setStatus(String(remote?.status || product.status || 'active').toLowerCase());
      setDescLocal(remoteDesc);
      const [nCount, hits] = await Promise.all([
        fetchNotifyCount(sku),
        getSoldOutHits(storeId, sku),
      ]);
      if (cancelled) return;
      setNotifyCount(nCount);
      setSoldOutHits(hits);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [product, sku, storeId]);

  if (!product) return null;

  const name = fresh?.name || product.name;
  const category = fresh?.category || product.category || '';
  const description = descLocal;
  const img = fresh?.img || product.img;
  const gallery = (() => {
    const fromApi = Array.isArray(fresh?.images) ? fresh!.images!.filter(Boolean) : [];
    const fromTile = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
    const list = (fromApi.length ? fromApi : fromTile).map(String);
    if (img && !list.includes(img)) list.unshift(img);
    return list.length ? list : img ? [img] : [];
  })();
  const statusStyle = STATUS_COLORS[status] || STATUS_COLORS.active;
  const discount = getProductDiscount(salePriceDraft, listPriceDraft);
  const hasPromo = !!discount;

  const savePatch = async (patch: {
    quantity?: number;
    price?: string;
    list_price?: string;
    clear_discount?: boolean;
    status?: string;
    description?: string;
  }) => {
    setBusy(true);
    const nextDesc = patch.description ?? description;
    const ok = await patchSellerProduct({
      sku,
      name,
      store_id: storeId,
      category: category || undefined,
      description: nextDesc || undefined,
      img: img || undefined,
      quantity: patch.quantity ?? qty,
      price: priceText(patch.price ?? (hasPromo ? salePriceDraft : priceDraft)),
      list_price:
        patch.list_price !== undefined
          ? patch.list_price
            ? priceText(patch.list_price)
            : ''
          : hasPromo && listPriceDraft
            ? priceText(listPriceDraft)
            : undefined,
      status: patch.status ?? status,
      clear_discount: patch.clear_discount,
    });
    setBusy(false);
    if (!ok) {
      Alert.alert('Could not save', 'Check your connection and try again.');
      return false;
    }
    if (patch.description != null) setDescLocal(patch.description);
    onUpdated?.();
    return true;
  };

  const bumpQty = async (delta: number) => {
    const next = Math.max(0, qty + delta);
    if (next === 0 && qty > 0) {
      const hits = await bumpSoldOutHit(storeId, sku);
      setSoldOutHits(hits);
    }
    setQty(next);
    tapHaptic();
    await savePatch({ quantity: next });
  };

  const savePrice = async () => {
    const cleaned = priceDraft.replace(/[^\d.]/g, '');
    if (!cleaned) {
      Alert.alert('Price needed', 'Enter a number.');
      return;
    }
    const newPrice = parsePriceNum(cleaned);
    const oldRef = hasPromo
      ? parsePriceNum(listPriceDraft)
      : parsePriceNum(String(fresh?.price || product.price || ''));
    const drop = oldRef > 0 ? (oldRef - newPrice) / oldRef : 0;
    const apply = async () => {
      const formatted = formatPriceNum(newPrice);
      setPriceDraft(formatted);
      setListPriceDraft('');
      setSalePriceDraft('');
      await savePatch({
        price: formatted,
        list_price: '',
        clear_discount: true,
      });
      successHaptic();
    };
    if (!hasPromo && drop > 0.3) {
      warnHaptic();
      Alert.alert('Big price drop', `Drop ${Math.round(drop * 100)}%?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', style: 'destructive', onPress: () => void apply() },
      ]);
      return;
    }
    await apply();
  };

  const setStatusQuick = async (next: 'active' | 'draft') => {
    setStatus(next);
    await savePatch({ status: next });
  };

  const togglePromo = async () => {
    if (!hasPromo) {
      const list = parsePriceNum(priceDraft);
      if (list <= 0) {
        Alert.alert('Set a price first', 'Enter a price before applying 10% off.');
        return;
      }
      const sale = saleFromList(list);
      const listStr = formatPriceNum(list);
      const saleStr = formatPriceNum(sale);
      setListPriceDraft(listStr);
      setSalePriceDraft(saleStr);
      setPriceDraft(listStr);
      await savePatch({
        price: saleStr,
        list_price: listStr,
      });
    } else {
      const list = parsePriceNum(listPriceDraft) || parsePriceNum(priceDraft);
      const listStr = formatPriceNum(list);
      setListPriceDraft('');
      setSalePriceDraft('');
      setPriceDraft(listStr);
      await savePatch({
        price: listStr,
        list_price: '',
        clear_discount: true,
      });
    }
    void appendChangeLog(
      storeId,
      hasPromo ? `Removed promo on ${name}` : `10% off on ${name}`,
      sku,
    );
    successHaptic();
  };

  const suggestPrice = async () => {
    setBusy(true);
    const out = await fetchAiPricing(storeId, sku);
    setBusy(false);
    if (out?.suggested_price != null) {
      setPricingTip(out.rationale || null);
      const suggested = formatPriceNum(out.suggested_price);
      setPriceDraft(suggested);
      tapHaptic();
    }
  };

  const onPriceDraftChange = (raw: string) => {
    const cleaned = raw.replace(/[^\d.]/g, '');
    setPriceDraft(cleaned);
    setPricingTip(null);
  };

  const notifyBuyers = async () => {
    if (notifyCount <= 0) {
      Alert.alert('No waitlist', 'Nobody asked to be notified yet.');
      return;
    }
    setBusy(true);
    const result = await broadcastNotify(sku, storeId);
    setBusy(false);
    successHaptic();
    Alert.alert(
      'Notified',
      result.message
        ? `Sent to ${result.notified} buyer${result.notified === 1 ? '' : 's'}:\n\n"${result.message}"`
        : `Pinged ${result.notified} buyer${result.notified === 1 ? '' : 's'}.`,
    );
  };

  const goEdit = () => {
    onClose();
    router.push({
      pathname: '/inventory/edit',
      params: { id: sku, storeId: String(storeId) },
    });
  };

  return (
    <Modal
      visible={!!product}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheetPressable} onPress={(e) => e.stopPropagation()}>
          <GlassPane
            scheme="light"
            intensity="strong"
            radius={Glass.radius.xl}
            style={styles.sheet}
            contentStyle={styles.sheetContent}
          >
            <View style={styles.handle} />

          <View style={styles.imageWrap}>
            <ProductImageGallery images={gallery} height={200} borderRadius={16} />
            <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
              <Text style={[styles.statusText, { color: statusStyle.text }]}>
                {statusStyle.label}
              </Text>
            </View>
            {hasPromo ? (
              <View style={[styles.statusBadge, styles.promoBadge]}>
                <Text style={styles.promoBadgeText}>{discount!.percentOff}% OFF</Text>
              </View>
            ) : null}
          </View>

          <ScrollView
            style={styles.scrollView}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            bounces
          >
            <View style={styles.headRow}>
              <Text style={styles.name}>{name}</Text>
              {loading || busy ? <ActivityIndicator size="small" color={Glass.ink.lightSecondary} /> : null}
            </View>

            <View style={styles.priceBlock}>
              {hasPromo && listPriceDraft ? (
                <View style={styles.promoPriceRow}>
                  <Text style={styles.listPriceStrike}>${listPriceDraft}</Text>
                  <Text style={styles.salePrice}>${salePriceDraft}</Text>
                </View>
              ) : null}
              <Text style={styles.priceEditLabel}>
                {hasPromo ? 'Edit original price (saving removes discount)' : 'Edit price'}
              </Text>
              <View style={styles.priceRow}>
                <Text style={styles.dollar}>$</Text>
                <TextInput
                  style={styles.priceInput}
                  value={priceDraft}
                  onChangeText={onPriceDraftChange}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={SellerTheme.textSecondary}
                />
                <Pressable
                  style={({ pressed }) => [styles.miniSave, pressed && styles.pressed]}
                  onPress={() => void savePrice()}
                  disabled={busy}
                >
                  <Text style={styles.miniSaveText}>Save</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.aiPriceBtn, pressed && styles.pressed]}
                  onPress={() => void suggestPrice()}
                  disabled={busy}
                >
                  <Text style={styles.aiPriceText}>AI price</Text>
                </Pressable>
              </View>
              {hasPromo ? (
                <Text style={styles.promoHint}>
                  Current sale price ${salePriceDraft} · {discount!.percentOff}% off
                </Text>
              ) : null}
              {pricingTip ? <Text style={styles.pricingTip}>{pricingTip}</Text> : null}
            </View>

            <View style={styles.actionBlock}>
              <Text style={styles.actionLabel}>Stock</Text>
              <View style={styles.stepper}>
                <Pressable
                  style={styles.stepBtn}
                  onPress={() => void bumpQty(-1)}
                  disabled={busy || qty <= 0}
                >
                  <Ionicons name="remove" size={18} color={Glass.ink.light} />
                </Pressable>
                <Text style={styles.stepQty}>{qty}</Text>
                <Pressable
                  style={styles.stepBtn}
                  onPress={() => void bumpQty(1)}
                  disabled={busy}
                >
                  <Ionicons name="add" size={18} color={Glass.ink.light} />
                </Pressable>
                <Pressable
                  style={styles.restockBtn}
                  onPress={() => void bumpQty(5)}
                  disabled={busy}
                >
                  <Text style={styles.restockText}>+5</Text>
                </Pressable>
                {qty === 0 || qty < 3 ? (
                  <Pressable
                    style={[styles.restockBtn, { backgroundColor: Glass.tint.green }]}
                    onPress={async () => {
                      const next = soldOutHits >= 2 ? 20 : 10;
                      setQty(next);
                      await savePatch({ quantity: next });
                      successHaptic();
                    }}
                    disabled={busy}
                  >
                    <Text style={styles.restockText}>
                      {soldOutHits >= 2 ? '→20' : '→10'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              {soldOutHits >= 2 && qty === 0 ? (
                <Text style={styles.roiHint}>
                  Sold out {soldOutHits}× — restock →20?
                </Text>
              ) : null}
            </View>

            <View style={styles.actionBlock}>
              <Text style={styles.actionLabel}>Sell more</Text>
              <View style={styles.chipRow}>
                <Pressable
                  onPress={() => void notifyBuyers()}
                  disabled={busy}
                >
                  <GlassPill
                    scheme="light"
                    active={notifyCount > 0}
                    activeColor={SellerTheme.chipActive}
                    style={styles.actionChip}
                  >
                    <Text
                      style={[
                        styles.actionChipText,
                        notifyCount > 0 && styles.actionChipTextHot,
                      ]}
                    >
                      Notify buyers{notifyCount > 0 ? ` (${notifyCount})` : ''}
                    </Text>
                  </GlassPill>
                </Pressable>
                <Pressable
                  onPress={() => void togglePromo()}
                  disabled={busy}
                >
                  <GlassPill
                    scheme="light"
                    active={hasPromo}
                    activeColor={SellerTheme.chipActive}
                    style={styles.actionChip}
                  >
                    <Text
                      style={[styles.actionChipText, hasPromo && styles.actionChipTextOn]}
                    >
                      {hasPromo ? `${discount!.percentOff}% off` : '10% off'}
                    </Text>
                  </GlassPill>
                </Pressable>
              </View>
            </View>

            {status !== 'trash' ? (
              <View style={styles.actionBlock}>
                <Text style={styles.actionLabel}>Status</Text>
                <View style={styles.statusRow}>
                  {(['active', 'draft'] as const).map((s) => (
                    <Pressable
                      key={s}
                      onPress={() => void setStatusQuick(s)}
                      disabled={busy}
                    >
                      <GlassPill
                        scheme="light"
                        active={status === s}
                        activeColor={SellerTheme.chipActive}
                        style={styles.statusChip}
                      >
                        <Text
                          style={[
                            styles.statusChipText,
                            status === s && styles.statusChipTextOn,
                          ]}
                        >
                          {s === 'active' ? 'Active' : 'Draft'}
                        </Text>
                      </GlassPill>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={styles.metaRow}>
              {category ? (
                <View style={styles.metaChip}>
                  <Ionicons name="pricetag-outline" size={13} color={Glass.ink.lightSecondary} />
                  <Text style={styles.metaText}>{category}</Text>
                </View>
              ) : null}
              <View style={styles.metaChip}>
                <Ionicons name="barcode-outline" size={13} color={Glass.ink.lightSecondary} />
                <Text style={styles.metaText}>{sku}</Text>
              </View>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
              onPress={onClose}
            >
              <Text style={styles.secondaryText}>Done</Text>
            </Pressable>
            <Pressable
              onPress={goEdit}
            >
              <GlassPill scheme="light" style={styles.ghostBtn}>
                <Ionicons name="create-outline" size={16} color={Glass.tint.blue} />
                <Text style={styles.ghostText}>More fields</Text>
              </GlassPill>
            </Pressable>
          </View>
          </GlassPane>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(6,8,18,0.6)',
    justifyContent: 'flex-end',
  },
  sheetPressable: {
    maxHeight: '88%',
    flexShrink: 1,
  },
  sheet: {
    borderTopLeftRadius: Glass.radius.xl,
    borderTopRightRadius: Glass.radius.xl,
    flexShrink: 1,
  },
  sheetContent: {
    paddingHorizontal: 18,
    paddingBottom: 16,
    flexShrink: 1,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Glass.stroke.lightOuter,
    marginTop: 8,
    marginBottom: 6,
  },
  scroll: { paddingBottom: 16 },
  scrollView: { flexGrow: 0, flexShrink: 1, maxHeight: 340 },
  imageWrap: {
    marginTop: 6,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: Glass.fill.lightSoft,
  },
  image: { width: '100%', height: 200, backgroundColor: Glass.fill.lightSoft },
  imageFallback: { alignItems: 'center', justifyContent: 'center' },
  statusBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  promoBadge: {
    left: undefined,
    right: 12,
    backgroundColor: Glass.tint.red,
  },
  promoBadgeText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  statusText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 14,
  },
  name: { flex: 1, fontSize: 20, fontWeight: '800', color: SellerTheme.text },
  priceBlock: { marginTop: 10, gap: 4 },
  promoPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  listPriceStrike: {
    fontSize: 18,
    fontWeight: '700',
    color: Glass.tint.red,
    textDecorationLine: 'line-through',
  },
  salePrice: { fontSize: 20, color: Glass.tint.blue, fontWeight: '900' },
  priceEditLabel: {
    fontSize: 11,
    color: SellerTheme.textSecondary,
    fontWeight: '700',
    marginTop: 4,
  },
  promoHint: { fontSize: 12, color: Glass.tint.green, fontWeight: '600', marginTop: 2 },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 4,
  },
  dollar: { fontSize: 22, fontWeight: '800', color: Glass.tint.blue },
  priceInput: {
    flex: 1,
    fontSize: 22,
    fontWeight: '800',
    color: SellerTheme.text,
    paddingVertical: 4,
  },
  miniSave: {
    backgroundColor: Glass.fill.light,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  miniSaveText: { fontWeight: '800', color: Glass.tint.blue, fontSize: 13 },
  aiPriceBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Glass.fill.light,
  },
  aiPriceText: { fontWeight: '800', color: Glass.tint.blue, fontSize: 12 },
  pricingTip: {
    fontSize: 12,
    color: SellerTheme.textSecondary,
    marginTop: 6,
    fontStyle: 'italic',
    lineHeight: 17,
  },
  actionBlock: { marginTop: 16, gap: 8 },
  actionLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: SellerTheme.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Glass.stroke.lightOuter,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Glass.fill.light,
  },
  stepQty: {
    minWidth: 36,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '800',
    color: SellerTheme.text,
  },
  restockBtn: {
    marginLeft: 4,
    backgroundColor: Glass.tint.blue,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Glass.radius.pill,
  },
  restockText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  roiHint: { fontSize: 12, color: Glass.tint.amber, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  actionChipText: { fontWeight: '700', color: SellerTheme.text, fontSize: 13 },
  actionChipTextHot: { color: SellerTheme.chipActiveText },
  actionChipTextOn: { color: SellerTheme.chipActiveText },
  statusRow: { flexDirection: 'row', gap: 8 },
  statusChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  statusChipText: { fontWeight: '700', color: SellerTheme.text, fontSize: 13 },
  statusChipTextOn: { color: SellerTheme.chipActiveText },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Glass.fill.light,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  metaText: { fontSize: 12, color: SellerTheme.textSecondary, fontWeight: '600' },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Glass.stroke.lightOuter,
  },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: Glass.radius.pill,
    backgroundColor: Glass.tint.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: Glass.radius.pill,
  },
  ghostText: { fontSize: 13, fontWeight: '700', color: Glass.tint.blue },
  pressed: { opacity: 0.85 },
});
