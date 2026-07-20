import AsyncStorage from '@react-native-async-storage/async-storage';
import { SellerCategory } from '@/shared/theme/SellerTheme';

const LAST_KEY = '@seller_last_listed';
const REPLIES_KEY = '@seller_pinned_replies';
const DONE_KEY = '@seller_done_today';
const LOG_KEY = '@seller_change_log';
const SETTINGS_KEY = '@seller_store_settings';
const FORM_DRAFT_KEY = '@seller_form_draft';
const STARTER_STATS_KEY = '@seller_starter_stats';
const MOVERS_KEY = '@seller_movers';

export type LastListedProduct = {
  storeId: string;
  name: string;
  price: string;
  category: SellerCategory | string;
  quantity: number;
  description?: string;
  img?: string;
};

export type ChangeLogEntry = {
  id: string;
  storeId: string;
  sku?: string;
  label: string;
  at: string;
};

export type StoreSellerSettings = {
  autoDraftSoldOut: boolean;
};

export type FormDraft = {
  storeId: string;
  step?: number;
  name?: string;
  price?: string;
  category?: string;
  quantity?: string;
  description?: string;
  photoUri?: string;
  updatedAt: string;
};

export async function saveLastListed(product: LastListedProduct): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_KEY, JSON.stringify(product));
  } catch {
    // ignore
  }
}

export async function loadLastListed(
  storeId?: string,
): Promise<LastListedProduct | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastListedProduct;
    if (storeId && parsed.storeId && parsed.storeId !== storeId) return null;
    return parsed;
  } catch {
    return null;
  }
}

const DEFAULT_REPLIES = [
  'Yes, in stock',
  'Ships in 2–3 days',
  'Check the product page for details',
  "I'll restock soon",
];

export async function loadPinnedReplies(storeId: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(`${REPLIES_KEY}_${storeId}`);
    if (!raw) return DEFAULT_REPLIES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed.map(String) : DEFAULT_REPLIES;
  } catch {
    return DEFAULT_REPLIES;
  }
}

export async function savePinnedReplies(
  storeId: string,
  replies: string[],
): Promise<void> {
  try {
    const cleaned = replies.map((r) => r.trim()).filter(Boolean).slice(0, 6);
    await AsyncStorage.setItem(
      `${REPLIES_KEY}_${storeId}`,
      JSON.stringify(cleaned.length ? cleaned : DEFAULT_REPLIES),
    );
  } catch {
    // ignore
  }
}

function todayKey(storeId: string) {
  const d = new Date();
  return `${DONE_KEY}_${storeId}_${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export type DoneToday = {
  lowStock?: boolean;
  drafts?: boolean;
  queries?: boolean;
};

export async function loadDoneToday(storeId: string): Promise<DoneToday> {
  try {
    const raw = await AsyncStorage.getItem(todayKey(storeId));
    if (!raw) return {};
    return JSON.parse(raw) as DoneToday;
  } catch {
    return {};
  }
}

export async function saveDoneToday(storeId: string, done: DoneToday): Promise<void> {
  try {
    await AsyncStorage.setItem(todayKey(storeId), JSON.stringify(done));
  } catch {
    // ignore
  }
}

export async function appendChangeLog(
  storeId: string,
  label: string,
  sku?: string,
): Promise<void> {
  try {
    const key = `${LOG_KEY}_${storeId}`;
    const raw = await AsyncStorage.getItem(key);
    const list: ChangeLogEntry[] = raw ? JSON.parse(raw) : [];
    list.unshift({
      id: `${Date.now()}`,
      storeId,
      sku,
      label,
      at: new Date().toISOString(),
    });
    await AsyncStorage.setItem(key, JSON.stringify(list.slice(0, 30)));
  } catch {
    // ignore
  }
}

export async function loadChangeLog(storeId: string): Promise<ChangeLogEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(`${LOG_KEY}_${storeId}`);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function loadStoreSettings(storeId: string): Promise<StoreSellerSettings> {
  try {
    const raw = await AsyncStorage.getItem(`${SETTINGS_KEY}_${storeId}`);
    if (!raw) return { autoDraftSoldOut: false };
    return { autoDraftSoldOut: false, ...JSON.parse(raw) };
  } catch {
    return { autoDraftSoldOut: false };
  }
}

export async function saveStoreSettings(
  storeId: string,
  settings: StoreSellerSettings,
): Promise<void> {
  try {
    await AsyncStorage.setItem(`${SETTINGS_KEY}_${storeId}`, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export async function saveFormDraft(draft: FormDraft): Promise<void> {
  try {
    await AsyncStorage.setItem(
      `${FORM_DRAFT_KEY}_${draft.storeId}`,
      JSON.stringify(draft),
    );
  } catch {
    // ignore
  }
}

export async function loadFormDraft(storeId: string): Promise<FormDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(`${FORM_DRAFT_KEY}_${storeId}`);
    if (!raw) return null;
    return JSON.parse(raw) as FormDraft;
  } catch {
    return null;
  }
}

export async function clearFormDraft(storeId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(`${FORM_DRAFT_KEY}_${storeId}`);
  } catch {
    // ignore
  }
}

export async function bumpStarterStat(storeId: string, label: string): Promise<void> {
  try {
    const key = `${STARTER_STATS_KEY}_${storeId}`;
    const raw = await AsyncStorage.getItem(key);
    const map: Record<string, number> = raw ? JSON.parse(raw) : {};
    map[label] = (map[label] || 0) + 1;
    await AsyncStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export async function loadStarterStats(storeId: string): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(`${STARTER_STATS_KEY}_${storeId}`);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
}

/** Track product interactions for "today's movers". */
export async function bumpMover(storeId: string, sku: string, name: string): Promise<void> {
  try {
    const d = new Date();
    const day = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const key = `${MOVERS_KEY}_${storeId}_${day}`;
    const raw = await AsyncStorage.getItem(key);
    const map: Record<string, { name: string; count: number }> = raw ? JSON.parse(raw) : {};
    const prev = map[sku] || { name, count: 0 };
    map[sku] = { name, count: prev.count + 1 };
    await AsyncStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export async function loadTopMovers(
  storeId: string,
  limit = 3,
): Promise<{ sku: string; name: string; count: number }[]> {
  try {
    const d = new Date();
    const day = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const key = `${MOVERS_KEY}_${storeId}_${day}`;
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const map = JSON.parse(raw) as Record<string, { name: string; count: number }>;
    return Object.entries(map)
      .map(([sku, v]) => ({ sku, name: v.name, count: v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  } catch {
    return [];
  }
}

const SOLD_OUT_KEY = '@seller_sold_out_hits';

export async function bumpSoldOutHit(storeId: string, sku: string): Promise<number> {
  try {
    const key = `${SOLD_OUT_KEY}_${storeId}`;
    const raw = await AsyncStorage.getItem(key);
    const map: Record<string, number> = raw ? JSON.parse(raw) : {};
    map[sku] = (map[sku] || 0) + 1;
    await AsyncStorage.setItem(key, JSON.stringify(map));
    return map[sku];
  } catch {
    return 0;
  }
}

export async function getSoldOutHits(storeId: string, sku: string): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(`${SOLD_OUT_KEY}_${storeId}`);
    if (!raw) return 0;
    const map = JSON.parse(raw) as Record<string, number>;
    return map[sku] || 0;
  } catch {
    return 0;
  }
}

export { DEFAULT_REPLIES };
