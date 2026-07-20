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
import {
  bumpSoldOutHit,
  getSoldOutHits,
  appendChangeLog,
} from '@/services/sellerLazyStore';
import { successHaptic, tapHaptic, warnHaptic } from '@/shared/utils/sellerHaptics';
import ProductImageGallery from '@/shared/ui/ProductImageGallery';

type Props = {
  product: TileProduct | null;
  storeId: string;
  onClose: () => void;
  /** Called after a successful quick edit so the chat can refresh tiles. */
  onUpdated?: () => void;
};

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: '#E4F6EA', text: '#1B7A3D', label: 'Active' },
  draft: { bg: '#FEF3D7', text: '#9A6B00', label: 'Draft' },
  trash: { bg: '#FBE3E1', text: '#B3261E', label: 'Trash' },
};

const PROMO_TAG = ' · 10% off';

function priceText(value?: string): string {
  const p = String(value || '').trim();
  if (!p) return '';
  return p.startsWith('$') ? p : `$${p}`;
}

function stripPromo(desc: string): string {
  return desc.replace(/\s*·\s*10%\s*off/gi, '').trim();
}

export default function SellerTileDetailModal({
  product,
  storeId,
  onClose,
  onUpdated,
}: Props) {
  const router = useRouter();
  const [fresh, setFresh] = useState<ApiSellerProduct | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [qty, setQty] = useState(0);
  const [priceDraft, setPriceDraft] = useState('');
  const [status, setStatus] = useState('active');
  const [descLocal, setDescLocal] = useState('');
  const [notifyCount, setNotifyCount] = useState(0);
  const [soldOutHits, setSoldOutHits] = useState(0);

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
      setPriceDraft(
        String(remote?.price || product.price || '')
          .replace(/^\$/, '')
          .trim(),
      );
      setStatus(String(remote?.status || product.status || 'active').toLowerCase());
      setDescLocal(String(remote?.description ?? product.description ?? ''));
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
  const hasPromo = /10%\s*off/i.test(description);

  const savePatch = async (patch: {
    quantity?: number;
    price?: string;
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
      price: priceText(patch.price ?? priceDraft),
      status: patch.status ?? status,
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
    const oldN = parseFloat(String(fresh?.price || product.price || '').replace(/[^\d.]/g, ''));
    const newN = parseFloat(cleaned);
    const drop = oldN > 0 ? (oldN - newN) / oldN : 0;
    const apply = async () => {
      setPriceDraft(cleaned);
      await savePatch({ price: cleaned });
      successHaptic();
    };
    if (drop > 0.3) {
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
    const base = stripPromo(description);
    const next = hasPromo ? base : `${base}${PROMO_TAG}`.trim();
    await savePatch({ description: next });
    void appendChangeLog(
      storeId,
      hasPromo ? `Removed promo on ${name}` : `10% off on ${name}`,
      sku,
    );
    successHaptic();
  };

  const notifyBuyers = async () => {
    if (notifyCount <= 0) {
      Alert.alert('No waitlist', 'Nobody asked to be notified yet.');
      return;
    }
    setBusy(true);
    const n = await broadcastNotify(sku);
    setBusy(false);
    successHaptic();
    Alert.alert('Notified', `Pinged ${n} buyer${n === 1 ? '' : 's'}.`);
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
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.imageWrap}>
              <ProductImageGallery images={gallery} height={200} borderRadius={16} />
              <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
                <Text style={[styles.statusText, { color: statusStyle.text }]}>
                  {statusStyle.label}
                </Text>
              </View>
              {hasPromo ? (
                <View style={[styles.statusBadge, styles.promoBadge]}>
                  <Text style={styles.promoBadgeText}>10% off</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.headRow}>
              <Text style={styles.name}>{name}</Text>
              {loading || busy ? <ActivityIndicator size="small" color="#888" /> : null}
            </View>

            <View style={styles.priceRow}>
              <Text style={styles.dollar}>$</Text>
              <TextInput
                style={styles.priceInput}
                value={priceDraft}
                onChangeText={(t) => setPriceDraft(t.replace(/[^\d.]/g, ''))}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor="#BBB"
              />
              <Pressable
                style={({ pressed }) => [styles.miniSave, pressed && styles.pressed]}
                onPress={() => void savePrice()}
                disabled={busy}
              >
                <Text style={styles.miniSaveText}>Save</Text>
              </Pressable>
            </View>

            <View style={styles.actionBlock}>
              <Text style={styles.actionLabel}>Stock</Text>
              <View style={styles.stepper}>
                <Pressable
                  style={styles.stepBtn}
                  onPress={() => void bumpQty(-1)}
                  disabled={busy || qty <= 0}
                >
                  <Ionicons name="remove" size={18} color="#111" />
                </Pressable>
                <Text style={styles.stepQty}>{qty}</Text>
                <Pressable
                  style={styles.stepBtn}
                  onPress={() => void bumpQty(1)}
                  disabled={busy}
                >
                  <Ionicons name="add" size={18} color="#111" />
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
                    style={[styles.restockBtn, { backgroundColor: '#1B7A3D' }]}
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
                  style={[styles.actionChip, notifyCount > 0 && styles.actionChipHot]}
                  onPress={() => void notifyBuyers()}
                  disabled={busy}
                >
                  <Text
                    style={[
                      styles.actionChipText,
                      notifyCount > 0 && styles.actionChipTextHot,
                    ]}
                  >
                    Notify buyers{notifyCount > 0 ? ` (${notifyCount})` : ''}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.actionChip, hasPromo && styles.actionChipOn]}
                  onPress={() => void togglePromo()}
                  disabled={busy}
                >
                  <Text
                    style={[styles.actionChipText, hasPromo && styles.actionChipTextOn]}
                  >
                    {hasPromo ? 'Promo on' : '10% off'}
                  </Text>
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
                      style={[styles.statusChip, status === s && styles.statusChipOn]}
                      onPress={() => void setStatusQuick(s)}
                      disabled={busy}
                    >
                      <Text
                        style={[
                          styles.statusChipText,
                          status === s && styles.statusChipTextOn,
                        ]}
                      >
                        {s === 'active' ? 'Active' : 'Draft'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={styles.metaRow}>
              {category ? (
                <View style={styles.metaChip}>
                  <Ionicons name="pricetag-outline" size={13} color="#555" />
                  <Text style={styles.metaText}>{category}</Text>
                </View>
              ) : null}
              <View style={styles.metaChip}>
                <Ionicons name="barcode-outline" size={13} color="#555" />
                <Text style={styles.metaText}>{sku}</Text>
              </View>
            </View>

            {description ? (
              <>
                <Text style={styles.sectionLabel}>Details</Text>
                <Text style={styles.description}>{description}</Text>
              </>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
              onPress={onClose}
            >
              <Text style={styles.secondaryText}>Done</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]}
              onPress={goEdit}
            >
              <Ionicons name="create-outline" size={16} color="#1D3557" />
              <Text style={styles.ghostText}>More fields</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingBottom: 16,
    maxHeight: '88%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#DADADA',
    marginTop: 8,
    marginBottom: 6,
  },
  scroll: { paddingBottom: 12 },
  imageWrap: {
    marginTop: 6,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#F2F2F2',
  },
  image: { width: '100%', height: 200, backgroundColor: '#F2F2F2' },
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
    backgroundColor: '#1D3557',
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
  name: { flex: 1, fontSize: 20, fontWeight: '800', color: '#111' },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 4,
  },
  dollar: { fontSize: 22, fontWeight: '800', color: '#1D3557' },
  priceInput: {
    flex: 1,
    fontSize: 22,
    fontWeight: '800',
    color: '#1D3557',
    paddingVertical: 4,
  },
  miniSave: {
    backgroundColor: '#EEF2F7',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  miniSaveText: { fontWeight: '800', color: '#1D3557', fontSize: 13 },
  actionBlock: { marginTop: 16, gap: 8 },
  actionLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#DDD',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAFAFA',
  },
  stepQty: {
    minWidth: 36,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '800',
    color: '#111',
  },
  restockBtn: {
    marginLeft: 4,
    backgroundColor: '#1D3557',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  restockText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  roiHint: { fontSize: 12, color: '#9A6B00', fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#DDD',
    backgroundColor: '#fff',
  },
  actionChipHot: { borderColor: '#1D3557', backgroundColor: '#EEF2F7' },
  actionChipOn: { backgroundColor: '#1D3557', borderColor: '#1D3557' },
  actionChipText: { fontWeight: '700', color: '#444', fontSize: 13 },
  actionChipTextHot: { color: '#1D3557' },
  actionChipTextOn: { color: '#fff' },
  statusRow: { flexDirection: 'row', gap: 8 },
  statusChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#DDD',
    backgroundColor: '#fff',
  },
  statusChipOn: { backgroundColor: '#1D3557', borderColor: '#1D3557' },
  statusChipText: { fontWeight: '700', color: '#444', fontSize: 13 },
  statusChipTextOn: { color: '#fff' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F4F4F5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  metaText: { fontSize: 12, color: '#444', fontWeight: '600' },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 18,
    marginBottom: 6,
  },
  description: { fontSize: 15, lineHeight: 22, color: '#333' },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#1D3557',
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
    borderRadius: 14,
    backgroundColor: '#EEF2F7',
  },
  ghostText: { fontSize: 13, fontWeight: '700', color: '#1D3557' },
  pressed: { opacity: 0.85 },
});
