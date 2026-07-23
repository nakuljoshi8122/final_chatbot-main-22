import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {
  SellerTheme,
  SellerCategory,
  SELLER_CATEGORIES,
} from '@/shared/theme/SellerTheme';
import { createInventoryItem, InventoryItem } from '@/services/inventoryStore';
import { patchSellerProduct } from '@/services/patchSellerProduct';
import {
  CATEGORY_TEMPLATES,
  PRICE_PRESETS,
} from '@/features/seller/data/productTemplates';
import {
  LastListedProduct,
  saveLastListed,
  loadLastListed,
  saveFormDraft,
  loadFormDraft,
  clearFormDraft,
} from '@/services/sellerLazyStore';
import { useVoiceRecording } from '@/shared/hooks/useVoiceRecording';
import { transcribeAudioFile } from '@/services/sttField';
import { successHaptic, tapHaptic } from '@/shared/utils/sellerHaptics';
import { fetchStoreProducts } from '@/services/storesApi';
import { guessProductFromImage } from '@/services/visionGuessApi';
import { fetchAiListingFromImage, fetchAiBatchPhotos } from '@/services/sellerAiApi';
import { GlassPane, GlassPill } from '@/shared/ui/Glass';
import { Glass } from '@/shared/theme/LiquidGlass';

export type AddProductSummary = {
  sku: string;
  name: string;
  price: string;
  category: string;
  quantity: number;
  hasDescription: boolean;
  hasPhoto: boolean;
};

type Props = {
  storeId: string;
  defaultCategory: string;
  onListed: (
    item: InventoryItem,
    summary: AddProductSummary,
    meta?: {
      continueBatch?: boolean;
      nextPhoto?: { uri: string; base64?: string };
      remaining?: { uri: string; base64?: string }[];
    },
  ) => void;
  initialPhoto?: { uri: string; base64?: string } | null;
  /** Prefill from "List similar" / last product. */
  prefills?: Partial<LastListedProduct> | null;
  /** Remaining photos from a prior batch continue. */
  initialQueue?: { uri: string; base64?: string }[];
  /** Live draft sync for seller chat context. */
  onDraftChange?: (draft: {
    in_progress: boolean;
    name?: string;
    price?: string;
    quantity?: string;
    category?: string;
    description?: string;
    hasPhoto?: boolean;
    source?: string;
    sku?: string;
  }) => void;
  /** Fields merged from agent chat replies into the open form. */
  chatSync?: {
    name?: string;
    price?: string;
    quantity?: string;
    category?: string;
    description?: string;
    sku?: string;
  } | null;
  /** Draft SKU from a prior chat/form sync (catalog status=draft until List product). */
  initialDraftSku?: string;
};

function normalizeCategory(raw: string): SellerCategory {
  const c = (raw || '').toLowerCase();
  if (c.includes('skin')) return 'Skincare';
  if (c.includes('apparel')) return 'Apparel';
  if ((SELLER_CATEGORIES as readonly string[]).includes(raw)) {
    return raw as SellerCategory;
  }
  return 'Handicrafts';
}

type Step = 1 | 2 | 3;

function nextDraftSku(cat: SellerCategory): string {
  const prefix = { Skincare: 'SK', Apparel: 'AP', Handicrafts: 'HC' }[cat] || 'HC';
  return `${prefix}-NEW-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

export default function SellerAddProductCard({
  storeId,
  defaultCategory,
  onListed,
  initialPhoto = null,
  prefills = null,
  initialQueue = [],
  onDraftChange,
  chatSync = null,
  initialDraftSku = '',
}: Props) {
  const [step, setStep] = useState<Step>(initialPhoto ? 2 : 1);
  const [name, setName] = useState(prefills?.name || '');
  const [price, setPrice] = useState(
    String(prefills?.price || '').replace(/^\$/, ''),
  );
  const [category, setCategory] = useState<SellerCategory>(
    normalizeCategory(String(prefills?.category || defaultCategory)),
  );
  const [quantity, setQuantity] = useState(
    String(prefills?.quantity ?? 10),
  );
  const [description, setDescription] = useState(prefills?.description || '');
  const [photos, setPhotos] = useState<{ uri: string; base64?: string }[]>(
    initialPhoto ? [initialPhoto] : [],
  );
  const photo = photos[0] || null;
  const [photoQueue, setPhotoQueue] = useState<{ uri: string; base64?: string }[]>(
    initialQueue,
  );
  const [lastListed, setLastListed] = useState<LastListedProduct | null>(null);
  const [showLooksLike, setShowLooksLike] = useState(false);
  const [priceHint, setPriceHint] = useState<string | null>(null);
  const [draftBanner, setDraftBanner] = useState(false);
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false);
  const [visionHint, setVisionHint] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [listening, setListening] = useState<'name' | 'price' | null>(null);
  const [categoryAvgs, setCategoryAvgs] = useState<Record<string, number>>({});
  const [batchAiTip, setBatchAiTip] = useState<string | null>(null);
  const [aiListingReady, setAiListingReady] = useState(false);
  const [draftSku, setDraftSku] = useState(initialDraftSku || '');
  const draftHydrated = React.useRef(false);
  const visionForUri = React.useRef<string | null>(null);
  const { isRecording, startRecording, stopRecording, isInitialized } =
    useVoiceRecording();

  useEffect(() => {
    if (prefills?.name) setName(prefills.name);
    if (prefills?.price) setPrice(String(prefills.price).replace(/^\$/, ''));
    if (prefills?.quantity != null) setQuantity(String(prefills.quantity));
    if (prefills?.category) setCategory(normalizeCategory(String(prefills.category)));
    if (prefills?.description) setDescription(prefills.description);
  }, [prefills]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [last, draft, products] = await Promise.all([
        loadLastListed(storeId),
        loadFormDraft(storeId),
        fetchStoreProducts(storeId, false),
      ]);
      if (cancelled) return;
      setLastListed(last);

      const avgs: Record<string, { sum: number; n: number }> = {};
      for (const p of products as { category?: string; price?: string }[]) {
        const cat = normalizeCategory(String(p.category || ''));
        const n = parseFloat(String(p.price || '').replace(/[^\d.]/g, ''));
        if (!n) continue;
        if (!avgs[cat]) avgs[cat] = { sum: 0, n: 0 };
        avgs[cat].sum += n;
        avgs[cat].n += 1;
      }
      const map: Record<string, number> = {};
      Object.entries(avgs).forEach(([k, v]) => {
        map[k] = Math.round((v.sum / v.n) * 100) / 100;
      });
      setCategoryAvgs(map);

      if (
        !draftHydrated.current &&
        !prefills &&
        !initialPhoto &&
        draft &&
        (draft.name || draft.price || draft.photoUri)
      ) {
        draftHydrated.current = true;
        if (draft.name) setName(draft.name);
        if (draft.price) setPrice(draft.price);
        if (draft.quantity) setQuantity(draft.quantity);
        if (draft.category) setCategory(normalizeCategory(draft.category));
        if (draft.description) setDescription(draft.description);
        if (draft.photoUri) setPhotos([{ uri: draft.photoUri }]);
        if (draft.step === 2 || draft.step === 3) setStep(draft.step as Step);
        setDraftBanner(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId, prefills, initialPhoto]);

  useEffect(() => {
    if (photoQueue.length >= 1 && photos.length >= 1) {
      void analyzeBatchQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoQueue.length, photos.length]);

  // Autosave draft (Tier 9)
  useEffect(() => {
    if (initialDraftSku) setDraftSku(initialDraftSku);
  }, [initialDraftSku]);

  useEffect(() => {
    const t = setTimeout(() => {
      void saveFormDraft({
        storeId,
        step,
        name,
        price,
        category,
        quantity,
        description,
        photoUri: photo?.uri,
        updatedAt: new Date().toISOString(),
      });
      onDraftChange?.({
        in_progress: true,
        name: name.trim() || undefined,
        price: price.trim() || undefined,
        quantity: quantity.trim() || undefined,
        category,
        description: description.trim() || undefined,
        hasPhoto: !!photo?.uri,
        source: 'form',
        sku: draftSku || undefined,
      });
    }, 600);
    return () => clearTimeout(t);
  }, [
    storeId,
    step,
    name,
    price,
    category,
    quantity,
    description,
    photo?.uri,
    draftSku,
    onDraftChange,
  ]);

  // Sync form edits to catalog as draft (until List product publishes active).
  useEffect(() => {
    if (!name.trim()) return;
    const t = setTimeout(() => {
      void (async () => {
        const sku = draftSku || nextDraftSku(category);
        const priceStr = price.trim()
          ? price.trim().startsWith('$')
            ? price.trim()
            : `$${price.trim()}`
          : '';
        const qty = Math.max(0, Math.floor(Number(quantity) || 0));
        const ok = await patchSellerProduct({
          sku,
          name: name.trim(),
          store_id: storeId,
          category,
          price: priceStr || undefined,
          quantity: qty,
          description: description.trim() || undefined,
          status: 'draft',
          img: photo?.uri,
        });
        if (ok && !draftSku) setDraftSku(sku);
      })();
    }, 900);
    return () => clearTimeout(t);
  }, [
    name,
    price,
    quantity,
    category,
    description,
    photo?.uri,
    draftSku,
    storeId,
  ]);

  useEffect(() => {
    if (!chatSync) return;
    if (chatSync.name) setName(chatSync.name);
    if (chatSync.price) setPrice(String(chatSync.price).replace(/^\$/, ''));
    if (chatSync.quantity != null) setQuantity(String(chatSync.quantity));
    if (chatSync.category) setCategory(normalizeCategory(String(chatSync.category)));
    if (chatSync.description) setDescription(chatSync.description);
    if (chatSync.sku) setDraftSku(chatSync.sku);
    if (chatSync.name || chatSync.price || chatSync.quantity) setStep(2);
  }, [chatSync]);

  const templates = CATEGORY_TEMPLATES[category] || [];
  const canList = !!name.trim() && !!price.trim() && quantity.trim() !== '';

  // After snap / batch continue: vision-fill name + description from the photo
  useEffect(() => {
    if (!initialPhoto?.base64 && !initialPhoto?.uri) return;
    if (visionForUri.current === initialPhoto.uri) return;
    visionForUri.current = initialPhoto.uri;
    void fillFromVision(initialPhoto, { onlyIfEmpty: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPhoto?.uri]);

  const fillFromVision = async (
    shot: { uri: string; base64?: string },
    opts?: { onlyIfEmpty?: boolean },
  ) => {
    if (!shot.base64) return;
    setAnalyzingPhoto(true);
    setVisionHint(null);
    try {
      const guess = await guessProductFromImage(shot.base64, category);
      if (!guess?.name) {
        setVisionHint('Could not read photo — fill name yourself');
        return;
      }
      const onlyEmpty = !!opts?.onlyIfEmpty;
      if (!onlyEmpty || !name.trim()) setName(guess.name);
      if (guess.description && (!onlyEmpty || !description.trim())) {
        setDescription(guess.description);
        setShowMore(true);
      }
      if (guess.category) {
        const cat = normalizeCategory(String(guess.category));
        setCategory(cat);
        const avg = categoryAvgs[cat];
        if (avg && !price.trim()) {
          setPrice(String(avg));
          setPriceHint(`~$${avg} avg in ${cat}`);
        }
      }
      setVisionHint(
        guess.generalized
          ? 'Named from photo (generalized — edit if needed)'
          : 'Named from photo',
      );
      successHaptic();
    } catch {
      setVisionHint('Could not read photo — fill name yourself');
    } finally {
      setAnalyzingPhoto(false);
    }
  };

  const aiAutoFillListing = async () => {
    if (!photo?.base64) {
      Alert.alert('Photo needed', 'Snap a photo first for AI auto-fill.');
      return;
    }
    setAnalyzingPhoto(true);
    const draft = await fetchAiListingFromImage(photo.base64, storeId, category);
    setAnalyzingPhoto(false);
    if (!draft?.ok) {
      Alert.alert('AI fill', draft?.error || 'Could not analyze photo.');
      return;
    }
    if (draft.name) setName(draft.name);
    if (draft.description) {
      setDescription(draft.description);
      setShowMore(true);
    }
    if (draft.category) setCategory(normalizeCategory(String(draft.category)));
    if (draft.suggested_price) setPrice(String(draft.suggested_price));
    if (draft.suggested_quantity) setQuantity(String(draft.suggested_quantity));
    setAiListingReady(true);
    setVisionHint('AI filled all fields — review or one-tap list');
    setStep(3);
    successHaptic();
  };

  const analyzeBatchQueue = async () => {
    const all = [...photos, ...photoQueue].filter((p) => p.base64);
    if (all.length < 2) return;
    const out = await fetchAiBatchPhotos(
      all.map((p) => ({ base64: p.base64! })),
      category,
    );
    if (out?.tip) setBatchAiTip(out.tip);
  };

  const applyPhotoGuess = (
    nextPhoto: { uri: string; base64?: string },
    opts?: { keepFields?: boolean; append?: boolean },
  ) => {
    if (opts?.append) {
      setPhotos((prev) => {
        if (prev.some((p) => p.uri === nextPhoto.uri)) return prev;
        return [...prev, nextPhoto].slice(0, 8);
      });
      tapHaptic();
      return;
    }
    setPhotos([nextPhoto]);
    setShowLooksLike(!!lastListed);
    setVisionHint(null);
    if (!opts?.keepFields) {
      // Price hint from averages while vision runs
      const avg = categoryAvgs[category];
      if (avg && !price.trim()) {
        setPrice(String(avg));
        setPriceHint(`~$${avg} avg in ${category}`);
      } else if (templates[0]?.price && !price.trim()) {
        setPrice(templates[0].price);
        setPriceHint(`Suggested $${templates[0].price}`);
      } else if (avg) {
        setPriceHint(`~$${avg} avg in ${category}`);
      }
    }
    setStep(2);
    tapHaptic();
    visionForUri.current = nextPhoto.uri;
    if (nextPhoto.base64 && !opts?.keepFields) {
      void fillFromVision(nextPhoto, { onlyIfEmpty: false });
    }
  };

  const pickPhoto = async (
    fromCamera: boolean,
    mode: 'primary' | 'batch' | 'append' = 'primary',
  ) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow access to attach a product photo.');
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({
          quality: 0.4,
          allowsEditing: true,
          aspect: [1, 1],
          base64: true,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.4,
          allowsEditing: true,
          aspect: [1, 1],
          base64: true,
        });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    let base64 = asset.base64 || '';
    if (!base64 && asset.uri) {
      try {
        base64 = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } catch {
        // keep uri
      }
    }
    const shot = { uri: asset.uri, base64 };
    if (mode === 'batch') {
      if (!photos.length) {
        applyPhotoGuess(shot);
      } else {
        setPhotoQueue((q) => [...q, shot]);
      }
      return;
    }
    if (mode === 'append') {
      applyPhotoGuess(shot, { append: true });
      return;
    }
    applyPhotoGuess(shot);
  };

  const removePhotoAt = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const listenField = async (field: 'name' | 'price') => {
    if (!isInitialized) {
      Alert.alert('Mic not ready', 'Allow microphone access and try again.');
      return;
    }
    if (isRecording) {
      setListening(null);
      const uri = await stopRecording();
      if (!uri) return;
      try {
        setListening(field);
        const text = await transcribeAudioFile(uri);
        if (field === 'name' && text) setName(text);
        if (field === 'price' && text) {
          const num = text.replace(/[^\d.]/g, '');
          if (num) setPrice(num);
        }
      } catch {
        Alert.alert('Could not hear that', 'Try again or type it.');
      } finally {
        setListening(null);
      }
      return;
    }
    setListening(field);
    await startRecording();
  };

  const applyTemplate = (t: { name: string; price: string; quantity: number }) => {
    setName(t.name);
    setPrice(t.price);
    setQuantity(String(t.quantity));
    setPriceHint(null);
  };

  const useLooksLikeLast = () => {
    if (!lastListed) return;
    setName(lastListed.name);
    setPrice(String(lastListed.price).replace(/^\$/, ''));
    setCategory(normalizeCategory(String(lastListed.category)));
    setQuantity(String(lastListed.quantity ?? 10));
    if (lastListed.description) setDescription(lastListed.description);
    setShowLooksLike(false);
    setPriceHint(null);
    successHaptic();
  };

  const bumpQty = (delta: number) => {
    const current = Math.max(0, Math.floor(Number(quantity) || 0));
    setQuantity(String(Math.max(0, current + delta)));
  };

  const doSubmit = async () => {
    if (!canList) {
      Alert.alert('Almost', 'Name, price, and quantity are needed.');
      setStep(2);
      return;
    }
    setSubmitting(true);
    try {
      const qty = Math.max(0, Math.floor(Number(quantity) || 0));
      const priceStr = price.trim().startsWith('$') ? price.trim() : `$${price.trim()}`;
      let item: InventoryItem;
      if (draftSku) {
        const ok = await patchSellerProduct({
          sku: draftSku,
          name: name.trim(),
          store_id: storeId,
          category,
          price: priceStr,
          quantity: qty,
          description: description.trim(),
          status: 'active',
          img: photo?.uri,
        });
        if (!ok) {
          throw new Error('Could not publish listing. Check the backend and try again.');
        }
        item = {
          id: draftSku,
          sku: draftSku,
          name: name.trim(),
          category,
          price: priceStr,
          description: description.trim(),
          categoryNotes: '',
          quantity: qty,
          status: 'active',
          imageUri: photo?.uri || '',
          imageUris: photos.map((p) => p.uri),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: 'seller',
          storeId,
        };
      } else {
        item = await createInventoryItem({
          name: name.trim(),
          price: priceStr,
          category,
          quantity: qty,
          description: description.trim(),
          categoryNotes: '',
          status: 'active',
          imageUri: photo?.uri,
          imageUris: photos.map((p) => p.uri),
          storeId,
        });
      }
      await saveLastListed({
        storeId,
        name: item.name,
        price: item.price,
        category: item.category,
        quantity: item.quantity,
        description: item.description,
      });
      await clearFormDraft(storeId);
      successHaptic();
      const summary: AddProductSummary = {
        sku: item.sku,
        name: item.name,
        price: item.price,
        category: item.category,
        quantity: item.quantity,
        hasDescription: !!item.description,
        hasPhoto: !!photo,
      };
      if (photoQueue.length > 0) {
        const [next, ...rest] = photoQueue;
        onListed(item, summary, {
          continueBatch: true,
          nextPhoto: next,
          remaining: rest,
        });
      } else {
        onListed(item, summary);
      }
    } catch (e) {
      Alert.alert('Could not list', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const stepLabel = useMemo(
    () =>
      step === 1 ? '1 · Photo' : step === 2 ? '2 · Basics' : '3 · List',
    [step],
  );

  return (
    <GlassPane
      scheme="light"
      intensity="regular"
      radius={Glass.radius.lg}
      noBlur
      flat
      style={styles.card}
      contentStyle={styles.cardContent}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>New product</Text>
        <Text style={styles.stepPill}>{stepLabel}</Text>
      </View>

      <View style={styles.progress}>
        {[1, 2, 3].map((s) => (
          <View key={s} style={[styles.bar, step >= s && styles.barOn]} />
        ))}
      </View>

      {draftBanner ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Draft restored</Text>
          <TouchableOpacity
            onPress={() => {
              void clearFormDraft(storeId);
              setDraftBanner(false);
            }}
          >
            <Text style={styles.bannerLink}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {showLooksLike && lastListed ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText} numberOfLines={1}>
            Looks like last: {lastListed.name}
          </Text>
          <TouchableOpacity onPress={useLooksLikeLast}>
            <Text style={styles.bannerLink}>Use that</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowLooksLike(false)}>
            <Text style={styles.bannerMuted}>New</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {analyzingPhoto ? (
        <View style={styles.banner}>
          <ActivityIndicator size="small" color={Glass.tint.blue} />
          <Text style={styles.bannerText}>Reading photo for name & description…</Text>
        </View>
      ) : null}

      {visionHint && !analyzingPhoto ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{visionHint}</Text>
        </View>
      ) : null}

      {step === 1 ? (
        <View style={styles.stepBody}>
          <Text style={styles.hint}>
            Snap the product — add more angles after if you want.
          </Text>
          {photos.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.photoStrip}>
                {photos.map((p, i) => (
                  <View key={p.uri} style={styles.thumbWrap}>
                    <Image source={{ uri: p.uri }} style={styles.thumbPhoto} />
                    {i === 0 ? (
                      <Text style={styles.coverBadge}>Cover</Text>
                    ) : null}
                    <TouchableOpacity
                      style={styles.thumbRemove}
                      onPress={() => removePhotoAt(i)}
                    >
                      <Ionicons name="close" size={12} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
                {photos.length < 8 ? (
                  <TouchableOpacity
                    style={styles.addThumb}
                    onPress={() => void pickPhoto(true, 'append')}
                  >
                    <Ionicons name="add" size={22} color={Glass.tint.blue} />
                    <Text style={styles.addThumbText}>Add</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </ScrollView>
          ) : (
            <View style={styles.photoPlaceholder}>
              <Ionicons name="camera-outline" size={36} color={SellerTheme.textSecondary} />
            </View>
          )}
          {photoQueue.length > 0 ? (
            <Text style={styles.queueHint}>
              {photoQueue.length} more products in batch queue
              {batchAiTip ? `\n${batchAiTip}` : ''}
            </Text>
          ) : null}
          {photo?.base64 ? (
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: 'rgba(106,91,255,0.94)' }]}
              onPress={() => void aiAutoFillListing()}
              disabled={analyzingPhoto}
            >
              {analyzingPhoto ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="sparkles" size={18} color="#fff" />
                  <Text style={styles.primaryText}>AI fill & review</Text>
                </>
              )}
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => void pickPhoto(true, photos.length ? 'append' : 'primary')}
          >
            <Ionicons name="camera" size={18} color="#fff" />
            <Text style={styles.primaryText}>
              {photos.length ? 'Add another photo' : 'Snap & continue'}
            </Text>
          </TouchableOpacity>
          <View style={styles.rowBtns}>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => void pickPhoto(true, 'batch')}
            >
              <Text style={styles.secondaryText}>+ Batch product</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => void pickPhoto(false, photos.length ? 'append' : 'primary')}
            >
              <Text style={styles.secondaryText}>Gallery</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep(2)}>
            <Text style={styles.secondaryText}>
              {photos.length ? 'Continue' : 'Skip photo'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {step === 2 ? (
        <View style={styles.stepBody}>
          <Text style={styles.hint}>
            {priceHint
              ? `Tap a template or fill basics. ${priceHint}`
              : 'Tap a template or fill the basics.'}
          </Text>

          <ScrollChips
            items={templates.map((t) => t.name)}
            onPick={(i) => applyTemplate(templates[i])}
          />

          <View style={styles.field}>
            <Text style={styles.label}>Name *</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Product name"
                placeholderTextColor={SellerTheme.textSecondary}
              />
              <TouchableOpacity
                style={[styles.mic, listening === 'name' && styles.micOn]}
                onPress={() => void listenField('name')}
              >
                <Ionicons
                  name={listening === 'name' && isRecording ? 'stop' : 'mic-outline'}
                  size={18}
                  color={listening === 'name' ? '#fff' : Glass.tint.blue}
                />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Price *</Text>
            <View style={styles.inputRow}>
              <Text style={styles.dollar}>$</Text>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={price}
                onChangeText={(t) => {
                  setPrice(t.replace(/[^\d.]/g, ''));
                  setPriceHint(null);
                }}
                keyboardType="decimal-pad"
                placeholder="28"
                placeholderTextColor={SellerTheme.textSecondary}
              />
              <TouchableOpacity
                style={[styles.mic, listening === 'price' && styles.micOn]}
                onPress={() => void listenField('price')}
              >
                <Ionicons
                  name={listening === 'price' && isRecording ? 'stop' : 'mic-outline'}
                  size={18}
                  color={listening === 'price' ? '#fff' : Glass.tint.blue}
                />
              </TouchableOpacity>
            </View>
            <View style={styles.presetRow}>
              {PRICE_PRESETS.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.preset, price === p && styles.presetOn]}
                  onPress={() => {
                    setPrice(p);
                    setPriceHint(null);
                  }}
                >
                  <Text style={[styles.presetText, price === p && styles.presetTextOn]}>
                    ${p}
                  </Text>
                </TouchableOpacity>
              ))}
              {categoryAvgs[category] ? (
                <TouchableOpacity
                  style={styles.preset}
                  onPress={() => {
                    setPrice(String(categoryAvgs[category]));
                    setPriceHint(null);
                  }}
                >
                  <Text style={styles.presetText}>
                    Avg ${categoryAvgs[category]}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Qty *</Text>
            <View style={styles.qtyRow}>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => bumpQty(-1)}>
                <Ionicons name="remove" size={18} color={SellerTheme.text} />
              </TouchableOpacity>
              <TextInput
                style={styles.qtyInput}
                value={quantity}
                onChangeText={(t) => setQuantity(t.replace(/[^\d]/g, ''))}
                keyboardType="number-pad"
              />
              <TouchableOpacity style={styles.qtyBtn} onPress={() => bumpQty(1)}>
                <Ionicons name="add" size={18} color={SellerTheme.text} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.preset} onPress={() => setQuantity('10')}>
                <Text style={styles.presetText}>10</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.preset} onPress={() => bumpQty(5)}>
                <Text style={styles.presetText}>+5</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.catRow}>
            {SELLER_CATEGORIES.map((c) => (
              <GlassPill
                key={c}
                scheme="light"
                active={category === c}
                activeColor={SellerTheme.chipActive}
              >
                <TouchableOpacity
                  style={styles.catChip}
                  onPress={() => {
                    setCategory(c);
                    const avg = categoryAvgs[c];
                    if (avg) setPriceHint(`~$${avg} avg in ${c}`);
                  }}
                >
                  <Text style={[styles.catChipText, category === c && styles.catChipTextOn]}>
                    {c}
                  </Text>
                </TouchableOpacity>
              </GlassPill>
            ))}
          </View>

          <TouchableOpacity onPress={() => setShowMore((v) => !v)}>
            <Text style={styles.moreLink}>
              {showMore ? 'Hide extras' : 'Description / change photo'}
            </Text>
          </TouchableOpacity>
          {showMore ? (
            <View style={{ gap: 8 }}>
              <TextInput
                style={[styles.input, styles.inputMulti]}
                value={description}
                onChangeText={setDescription}
                placeholder="Optional description"
                placeholderTextColor={SellerTheme.textSecondary}
                multiline
              />
              <Text style={styles.label}>
                Photos ({photos.length}/8)
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.photoStrip}>
                  {photos.map((p, i) => (
                    <View key={p.uri} style={styles.thumbWrap}>
                      <Image source={{ uri: p.uri }} style={styles.thumbPhoto} />
                      {i === 0 ? <Text style={styles.coverBadge}>Cover</Text> : null}
                      <TouchableOpacity
                        style={styles.thumbRemove}
                        onPress={() => removePhotoAt(i)}
                      >
                        <Ionicons name="close" size={12} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {photos.length < 8 ? (
                    <>
                      <TouchableOpacity
                        style={styles.addThumb}
                        onPress={() => void pickPhoto(true, 'append')}
                      >
                        <Ionicons name="camera" size={18} color={Glass.tint.blue} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.addThumb}
                        onPress={() => void pickPhoto(false, 'append')}
                      >
                        <Ionicons name="images-outline" size={18} color={Glass.tint.blue} />
                      </TouchableOpacity>
                    </>
                  ) : null}
                </View>
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.rowBtns}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep(1)}>
              <Text style={styles.secondaryText}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryBtn, { flex: 1 }, !canList && styles.disabled]}
              onPress={() => setStep(3)}
              disabled={!canList}
            >
              <Text style={styles.primaryText}>Review</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {step === 3 ? (
        <View style={styles.stepBody}>
          <Text style={styles.hint}>
            {photoQueue.length
              ? `Looks good? List it — ${photoQueue.length} more in queue.`
              : 'Looks good? List it.'}
          </Text>
          {photo ? <Image source={{ uri: photo.uri }} style={styles.smallPhoto} /> : null}
          <View style={styles.summaryBlock}>
            <SummaryLine label="Name" value={name} />
            <SummaryLine label="Price" value={`$${price}`} />
            <SummaryLine label="Qty" value={quantity} />
            <SummaryLine label="Category" value={category} />
            <SummaryLine
              label="Photos"
              value={photos.length ? `${photos.length}` : 'Skipped'}
              muted={!photos.length}
            />
            <SummaryLine
              label="Desc"
              value={description.trim() || 'Skipped'}
              muted={!description.trim()}
            />
          </View>
          <TouchableOpacity
            style={[styles.primaryBtn, submitting && styles.disabled]}
            onPress={() => void doSubmit()}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={18} color="#fff" />
                <Text style={styles.primaryText}>
                  {aiListingReady ? 'One-tap list' : 'List product'}
                </Text>
              </>
            )}
          </TouchableOpacity>
          {aiListingReady ? (
            <Text style={styles.hint}>AI pre-filled — tap to publish instantly.</Text>
          ) : null}
          <TouchableOpacity onPress={() => setStep(2)}>
            <Text style={styles.moreLink}>Edit basics</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </GlassPane>
  );
}

function SummaryLine({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <View style={styles.summaryLine}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, muted && { color: SellerTheme.textSecondary }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function ScrollChips({
  items,
  onPick,
}: {
  items: string[];
  onPick: (index: number) => void;
}) {
  return (
    <View style={styles.templateRow}>
      {items.map((label, i) => (
        <GlassPill key={label} scheme="light" style={styles.templatePill}>
          <TouchableOpacity style={styles.templateChip} onPress={() => onPick(i)}>
            <Text style={styles.templateText} numberOfLines={1}>
              {label}
            </Text>
          </TouchableOpacity>
        </GlassPill>
      ))}
    </View>
  );
}

export function AddProductSummaryCard({
  summary,
  onAddAnother,
  onListSimilar,
}: {
  summary: AddProductSummary;
  onAddAnother?: () => void;
  onListSimilar?: () => void;
}) {
  const rows: { label: string; value: string; ok: boolean }[] = [
    { label: 'Name', value: summary.name, ok: true },
    { label: 'Price', value: summary.price, ok: true },
    { label: 'Category', value: summary.category, ok: true },
    { label: 'Quantity', value: String(summary.quantity), ok: true },
    {
      label: 'Description',
      value: summary.hasDescription ? 'Filled' : 'Skipped',
      ok: summary.hasDescription,
    },
    {
      label: 'Photo',
      value: summary.hasPhoto ? 'Attached' : 'Skipped',
      ok: summary.hasPhoto,
    },
  ];
  return (
    <GlassPane
      scheme="light"
      intensity="regular"
      radius={Glass.radius.lg}
      noBlur
      flat
      style={styles.card}
      contentStyle={styles.cardContent}
    >
      <View style={styles.header}>
        <Ionicons name="checkmark-circle" size={18} color="#1B7F4E" />
        <Text style={[styles.headerTitle, { color: '#1B7F4E' }]}>Listed</Text>
      </View>
      <Text style={styles.hint}>
        {summary.name} ({summary.sku})
      </Text>
      {rows.map((r) => (
        <View key={r.label} style={styles.summaryLine}>
          <Ionicons
            name={r.ok ? 'checkmark-circle' : 'ellipse-outline'}
            size={15}
            color={r.ok ? '#1B7F4E' : '#A0A0A0'}
          />
          <Text style={styles.summaryLabel}>{r.label}</Text>
          <Text style={styles.summaryValue} numberOfLines={1}>
            {r.value}
          </Text>
        </View>
      ))}
      <View style={styles.rowBtns}>
        {onListSimilar ? (
          <TouchableOpacity style={styles.secondaryBtn} onPress={onListSimilar}>
            <Text style={styles.secondaryText}>List similar</Text>
          </TouchableOpacity>
        ) : null}
        {onAddAnother ? (
          <TouchableOpacity style={[styles.primaryBtn, { flex: 1 }]} onPress={onAddAnother}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.primaryText}>Add another</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </GlassPane>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Glass.radius.lg,
    marginTop: 6,
  },
  cardContent: {
    padding: 12,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerTitle: { fontSize: 15, fontWeight: '800', color: SellerTheme.text },
  stepPill: {
    fontSize: 11,
    fontWeight: '800',
    color: SellerTheme.text,
    backgroundColor: SellerTheme.chipIdle,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  progress: { flexDirection: 'row', gap: 6 },
  bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: SellerTheme.stepperBg },
  barOn: { backgroundColor: Glass.tint.blue },
  stepBody: { gap: 10 },
  hint: { fontSize: 12.5, color: SellerTheme.textSecondary, lineHeight: 17 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(24,30,54,0.06)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: Glass.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Glass.stroke.lightOuter,
  },
  bannerText: { flex: 1, fontSize: 12, fontWeight: '700', color: SellerTheme.text },
  bannerLink: { fontSize: 12, fontWeight: '800', color: Glass.tint.blue },
  bannerMuted: { fontSize: 12, fontWeight: '600', color: SellerTheme.textSecondary },
  queueHint: { fontSize: 12, fontWeight: '700', color: Glass.tint.blue },
  heroPhoto: { width: '100%', height: 160, borderRadius: 12, backgroundColor: '#F2F2F2' },
  photoStrip: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  thumbWrap: { position: 'relative' },
  thumbPhoto: { width: 72, height: 72, borderRadius: Glass.radius.sm, backgroundColor: SellerTheme.surface },
  thumbRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: Glass.radius.sm,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverBadge: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    backgroundColor: 'rgba(29,53,87,0.85)',
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    paddingHorizontal: 5,
    paddingVertical: 2,
    overflow: 'hidden',
    borderRadius: 4,
  },
  addThumb: {
    width: 72,
    height: 72,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Glass.stroke.lightOuter,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(24,30,54,0.06)',
    gap: 2,
  },
  addThumbText: { fontSize: 11, fontWeight: '700', color: SellerTheme.text },
  photoPlaceholder: {
    height: 120,
    borderRadius: Glass.radius.md,
    backgroundColor: 'rgba(24,30,54,0.06)',
    borderWidth: 1,
    borderColor: Glass.stroke.lightOuter,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallPhoto: { width: 72, height: 72, borderRadius: Glass.radius.sm, backgroundColor: SellerTheme.surface },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(61,123,255,0.94)',
    borderRadius: Glass.radius.pill,
    height: 46,
  },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  secondaryBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: Glass.radius.pill,
    backgroundColor: SellerTheme.chipIdle,
  },
  secondaryText: { color: SellerTheme.text, fontWeight: '700', fontSize: 13 },
  rowBtns: { flexDirection: 'row', gap: 8 },
  field: { gap: 6 },
  label: { fontSize: 12, fontWeight: '700', color: SellerTheme.text },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: 'rgba(24,30,54,0.06)',
    borderWidth: 1,
    borderColor: Glass.stroke.lightOuter,
    borderRadius: Glass.radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: SellerTheme.text,
  },
  inputMulti: { minHeight: 64, textAlignVertical: 'top' },
  dollar: { fontSize: 18, fontWeight: '800', color: Glass.tint.blue },
  mic: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: SellerTheme.chipIdle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micOn: { backgroundColor: Glass.tint.red },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  preset: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: SellerTheme.chipIdle,
  },
  presetOn: { backgroundColor: Glass.tint.blue },
  presetText: { fontSize: 12, fontWeight: '700', color: SellerTheme.text },
  presetTextOn: { color: '#fff' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Glass.stroke.lightOuter,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SellerTheme.chipIdle,
  },
  qtyInput: {
    width: 56,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
    color: SellerTheme.text,
    backgroundColor: 'rgba(24,30,54,0.06)',
    borderWidth: 1,
    borderColor: Glass.stroke.lightOuter,
    borderRadius: Glass.radius.sm,
    paddingVertical: 8,
  },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  catChipText: { fontSize: 13, fontWeight: '600', color: SellerTheme.text },
  catChipTextOn: { color: SellerTheme.chipActiveText },
  moreLink: {
    textAlign: 'center',
    color: Glass.tint.blue,
    fontWeight: '700',
    fontSize: 13,
    paddingVertical: 4,
  },
  templateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  templateChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  templatePill: { maxWidth: '48%' },
  templateText: { fontSize: 12, fontWeight: '700', color: Glass.tint.green },
  summaryBlock: { gap: 6 },
  summaryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  summaryLabel: { width: 78, fontSize: 13, color: SellerTheme.textSecondary, fontWeight: '600' },
  summaryValue: { flex: 1, fontSize: 13, color: SellerTheme.text, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
