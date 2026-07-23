import * as FileSystem from 'expo-file-system/legacy';
import boutiqueSeed from '@/features/inventory/data/boutiqueSeed.json';
import {
  InventoryStatus,
  SellerCategory,
  SELLER_CATEGORIES,
} from '@/shared/theme/SellerTheme';
import {
  permanentlyDeleteSellerProductOnApi,
  softDeleteSellerProductOnApi,
  syncSellerProductToApi,
} from '@/services/sellerSync';

const FILE_NAME = 'seller_inventory_v1.json';
const IMAGES_DIR = 'seller-images';

import { API_BASE } from '@/services/apiBase';

export type InventoryItem = {
  id: string;
  sku: string;
  name: string;
  category: SellerCategory;
  price: string;
  description: string;
  categoryNotes: string;
  quantity: number;
  status: InventoryStatus;
  imageUri?: string;
  /** Extra local/remote photos for the same product. */
  imageUris?: string[];
  createdAt: string;
  updatedAt: string;
  /** seed = from boutiqueSeed; seller = listed via add-product UI */
  source?: 'seed' | 'seller';
  /** Shop this listing belongs to */
  storeId?: string;
  /** Original price when a promo/discount is active. */
  listPrice?: string;
};

export type InventoryFormInput = {
  name: string;
  category: SellerCategory;
  price: string;
  sku?: string;
  description: string;
  categoryNotes: string;
  quantity: number;
  status: InventoryStatus;
  imageUri?: string;
  imageUris?: string[];
  storeId?: string;
  /** A deliberate price edit removes the active promotion. */
  clearDiscount?: boolean;
};

type SeedRow = {
  sku: string;
  name: string;
  price: string;
  category: string;
  description: string;
  categoryNotes: string;
};

function isSellerCategory(value: string): value is SellerCategory {
  return (SELLER_CATEGORIES as readonly string[]).includes(value);
}

function inventoryPath(): string {
  return `${FileSystem.documentDirectory}${FILE_NAME}`;
}

function imagesDir(): string {
  return `${FileSystem.documentDirectory}${IMAGES_DIR}/`;
}

export function productImageUrl(sku: string): string {
  return `${API_BASE}/product-images/${sku}.jpg`;
}

function seededQuantity(sku: string): number {
  let hash = 0;
  for (let i = 0; i < sku.length; i += 1) {
    hash = (hash * 31 + sku.charCodeAt(i)) >>> 0;
  }
  return 8 + (hash % 40);
}

const SEED_SKUS = new Set(
  (boutiqueSeed as SeedRow[]).map((r) => String(r.sku || '').toUpperCase()),
);

export function getSeedSkuSet(): Set<string> {
  return SEED_SKUS;
}

function buildSeedItems(): InventoryItem[] {
  const now = new Date().toISOString();
  const items: InventoryItem[] = [];
  (boutiqueSeed as SeedRow[]).forEach((row, index) => {
    if (!isSellerCategory(row.category)) return;
    const status: InventoryStatus =
      index % 11 === 0 ? 'draft' : 'active';
    items.push({
      id: row.sku,
      sku: row.sku,
      name: row.name,
      category: row.category,
      price: row.price || '',
      description: row.description || '',
      categoryNotes: row.categoryNotes || '',
      quantity: seededQuantity(row.sku),
      status,
      imageUri: productImageUrl(row.sku),
      createdAt: now,
      updatedAt: now,
      source: 'seed',
    });
  });
  return items;
}

/** Session + disk cache (no AsyncStorage — broken on Expo Go with newArch). */
let memoryCache: InventoryItem[] | null = null;

async function ensureImagesDir(): Promise<void> {
  const dir = imagesDir();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

/** Copy a picked photo into app sandboxed storage and return a stable file:// URI. */
export async function persistPickedImage(sourceUri: string, skuHint?: string): Promise<string> {
  await ensureImagesDir();
  const extMatch = sourceUri.match(/\.(jpe?g|png|webp|heic|gif)(\?|$)/i);
  const ext = (extMatch?.[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg');
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const name = `${(skuHint || 'photo').replace(/[^A-Za-z0-9_-]/g, '_')}_${stamp}.${ext}`;
  const dest = `${imagesDir()}${name}`;
  await FileSystem.copyAsync({ from: sourceUri, to: dest });
  return dest;
}

async function readAll(): Promise<InventoryItem[]> {
  if (memoryCache) {
    return normalizeStatuses(mergeMissingSeeds(memoryCache));
  }

  try {
    const path = inventoryPath();
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) {
      const raw = await FileSystem.readAsStringAsync(path);
      const parsed = JSON.parse(raw) as InventoryItem[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const merged = normalizeStatuses(mergeMissingSeeds(parsed));
        memoryCache = merged;
        if (merged.length !== parsed.length || merged.some((item, i) => item.status !== parsed[i]?.status)) {
          await writeAll(merged);
        }
        return merged;
      }
    }
  } catch {
    // fall through to seed
  }

  const seeded = buildSeedItems();
  memoryCache = seeded;
  await writeAll(seeded);
  return seeded;
}

/** Keep Pinterest/seed SKUs even after sellers add their own listings. */
function mergeMissingSeeds(items: InventoryItem[]): InventoryItem[] {
  const bySku = new Map(
    items.map((item) => [item.sku.toUpperCase(), item] as const),
  );
  let changed = false;
  for (const seed of buildSeedItems()) {
    const key = seed.sku.toUpperCase();
    if (!bySku.has(key)) {
      bySku.set(key, seed);
      changed = true;
    }
  }
  if (!changed) return items;
  return Array.from(bySku.values());
}

/** Drop legacy archive status (map to draft). */
function normalizeStatuses(items: InventoryItem[]): InventoryItem[] {
  let changed = false;
  const next = items.map((item) => {
    if ((item.status as string) !== 'archive') return item;
    changed = true;
    return { ...item, status: 'draft' as InventoryStatus };
  });
  return changed ? next : items;
}

async function writeAll(items: InventoryItem[]): Promise<void> {
  memoryCache = items;
  try {
    await FileSystem.writeAsStringAsync(inventoryPath(), JSON.stringify(items));
  } catch {
    // Keep in-memory copy for this session
  }
}

export async function loadInventory(): Promise<InventoryItem[]> {
  const items = await readAll();
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getInventoryItem(id: string): Promise<InventoryItem | null> {
  const items = await readAll();
  const key = id.trim();
  return (
    items.find((item) => item.id === key || item.sku === key) ??
    items.find((item) => item.sku.toUpperCase() === key.toUpperCase()) ??
    null
  );
}

/** Pull a chat/API-listed product into local inventory so edit/save works. */
export async function hydrateInventoryFromApi(row: {
  sku: string;
  name: string;
  category?: string;
  price?: string;
  list_price?: string | number;
  description?: string;
  category_notes?: string;
  quantity?: number;
  status?: string;
  img?: string;
  store_id?: string;
}): Promise<InventoryItem> {
  const items = await readAll();
  const sku = String(row.sku || '').trim().toUpperCase();
  if (!sku) throw new Error('Product SKU missing');

  const category = isSellerCategory(String(row.category || ''))
    ? (row.category as SellerCategory)
    : 'Handicrafts';
  const statusRaw = String(row.status || 'active').toLowerCase();
  // Legacy "archive" listings are treated as draft
  const status: InventoryStatus =
    statusRaw === 'draft' || statusRaw === 'archive'
      ? 'draft'
      : statusRaw === 'trash'
        ? 'trash'
        : 'active';

  const now = new Date().toISOString();
  const next: InventoryItem = {
    id: sku,
    sku,
    name: String(row.name || '').trim() || sku,
    category,
    price: String(row.price || '').trim(),
    listPrice: row.list_price ? String(row.list_price).trim() : undefined,
    description: String(row.description || '').trim(),
    categoryNotes: String(row.category_notes || '').trim(),
    quantity: Math.max(0, Math.floor(Number(row.quantity) || 0)),
    status,
    imageUri: row.img || productImageUrl(sku),
    createdAt: now,
    updatedAt: now,
    source: SEED_SKUS.has(sku) ? 'seed' : 'seller',
    storeId: row.store_id || undefined,
  };

  const index = items.findIndex(
    (item) => item.id === sku || item.sku.toUpperCase() === sku,
  );
  if (index >= 0) {
    next.createdAt = items[index].createdAt;
    next.imageUri = items[index].imageUri || next.imageUri;
    items[index] = { ...items[index], ...next, updatedAt: now };
    await writeAll(items);
    return items[index];
  }
  items.unshift(next);
  await writeAll(items);
  return next;
}

function nextSku(category: SellerCategory, items: InventoryItem[]): string {
  const prefix =
    category === 'Handicrafts' ? 'HC' : category === 'Apparel' ? 'AP' : 'SK';
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  const candidate = `${prefix}-NEW-${stamp}`;
  if (!items.some((item) => item.sku === candidate)) return candidate;
  return `${prefix}-NEW-${stamp}${items.length}`;
}

export async function createInventoryItem(
  input: InventoryFormInput,
): Promise<InventoryItem> {
  const items = await readAll();
  const now = new Date().toISOString();
  const sku = (input.sku || '').trim() || nextSku(input.category, items);
  const id = sku;
  if (items.some((item) => item.id === id || item.sku === sku)) {
    throw new Error(
      `SKU "${sku}" already exists. Clear SKU to auto-generate, or pick a new one.`,
    );
  }
  const imageUris = (input.imageUris || [])
    .map(String)
    .filter(Boolean);
  const primary = input.imageUri || imageUris[0] || productImageUrl(sku);
  const gallery = imageUris.length
    ? imageUris[0] === primary
      ? imageUris
      : [primary, ...imageUris.filter((u) => u !== primary)]
    : [primary];
  const item: InventoryItem = {
    id,
    sku,
    name: input.name.trim(),
    category: input.category,
    price: input.price.trim(),
    description: input.description.trim(),
    categoryNotes: input.categoryNotes.trim(),
    quantity: Math.max(0, Math.floor(input.quantity)),
    status: input.status,
    imageUri: primary,
    imageUris: gallery,
    createdAt: now,
    updatedAt: now,
    source: 'seller',
    storeId: input.storeId,
  };
  items.unshift(item);
  await writeAll(items);
  // upsert on API also updates visibility status for this SKU
  const synced = await syncSellerProductToApi(item, { forceRetag: true });
  if (!synced) {
    throw new Error(
      'Saved on device, but chat catalog sync failed. Check the backend and try Save again.',
    );
  }
  return item;
}

export async function updateInventoryItem(
  id: string,
  input: InventoryFormInput,
): Promise<InventoryItem> {
  const items = await readAll();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) throw new Error('Product not found.');
  const existing = items[index];
  const sku = (input.sku || existing.sku).trim() || existing.sku;
  if (items.some((item) => item.id !== id && item.sku === sku)) {
    throw new Error(`SKU "${sku}" already exists. Choose a different SKU.`);
  }
  const updated: InventoryItem = {
    ...existing,
    sku,
    name: input.name.trim(),
    category: input.category,
    price: input.price.trim(),
    listPrice: input.clearDiscount ? undefined : existing.listPrice,
    description: input.description.trim(),
    categoryNotes: input.categoryNotes.trim(),
    quantity: Math.max(0, Math.floor(input.quantity)),
    status: input.status,
    imageUri: input.imageUri || existing.imageUri || productImageUrl(sku),
    updatedAt: new Date().toISOString(),
    source: existing.source || 'seller',
    storeId: input.storeId || existing.storeId,
  };
  items[index] = updated;
  await writeAll(items);
  // Await so Draft→Active is committed before the edit screen navigates back
  const synced = await syncSellerProductToApi(updated, {
    clearDiscount: !!input.clearDiscount,
  });
  if (!synced) {
    throw new Error(
      'Saved on device, but chat catalog sync failed. Check the backend and try Save again.',
    );
  }
  return updated;
}

export async function setItemStatus(
  id: string,
  status: InventoryStatus,
): Promise<InventoryItem | null> {
  const items = await readAll();
  const index = items.findIndex((item) => item.id === id || item.sku === id);
  if (index < 0) return null;
  items[index] = {
    ...items[index],
    status,
    updatedAt: new Date().toISOString(),
  };
  await writeAll(items);
  const updated = items[index];
  // Soft-delete keeps the API row (status=trash) so Trash tab still lists it
  await syncSellerProductToApi(updated);
  void import('@/services/sellerSync').then(({ syncInventoryVisibilityToApi }) =>
    syncInventoryVisibilityToApi(items),
  );
  return updated;
}

/** Confirm-friendly delete: marks trash and keeps the listing for Restore. */
export async function deleteInventoryItem(id: string): Promise<boolean> {
  const existing = await getInventoryItem(id);
  if (!existing) {
    await softDeleteSellerProductOnApi(id);
    return true;
  }
  const updated = await setItemStatus(existing.id, 'trash');
  return !!updated;
}

/** Restore a trashed item back to Active. */
export async function restoreInventoryItem(id: string): Promise<InventoryItem | null> {
  return setItemStatus(id, 'active');
}

/**
 * Permanently erase a product: local row, API row, image, and seed visibility.
 * Cannot be undone.
 */
export async function permanentlyDeleteInventoryItem(id: string): Promise<boolean> {
  const items = await readAll();
  const index = items.findIndex(
    (item) => item.id === id || item.sku === id || item.sku.toUpperCase() === id.toUpperCase(),
  );
  const sku =
    index >= 0 ? items[index].sku : String(id || '').trim().toUpperCase();
  if (!sku) return false;

  if (index >= 0) {
    const removed = items[index];
    items.splice(index, 1);
    await writeAll(items);
    // Best-effort: remove locally cached photo
    if (removed.imageUri && !/^https?:\/\//i.test(removed.imageUri)) {
      try {
        await FileSystem.deleteAsync(removed.imageUri, { idempotent: true });
      } catch {
        // ignore
      }
    }
  }

  // Purge on API first (marks visibility purged), then sync remaining items
  await permanentlyDeleteSellerProductOnApi(sku);
  const remaining = await readAll();
  void import('@/services/sellerSync').then(({ syncInventoryVisibilityToApi }) =>
    syncInventoryVisibilityToApi(remaining),
  );
  return true;
}

export async function setItemQuantity(
  id: string,
  quantity: number,
): Promise<InventoryItem | null> {
  const items = await readAll();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return null;
  items[index] = {
    ...items[index],
    quantity: Math.max(0, Math.floor(quantity)),
    updatedAt: new Date().toISOString(),
  };
  await writeAll(items);
  const updated = items[index];
  // Await so chat/search cannot race ahead of the catalog write
  await syncSellerProductToApi(updated);
  return updated;
}

/** One-shot push of local inventory so chat can find it (AI tags on server). */
export async function pushSellerListingsToChat(): Promise<number> {
  const { syncSellerItemsToApi, requestSellerRetag } = await import('@/services/sellerSync');
  const items = await readAll();
  const count = await syncSellerItemsToApi(items, SEED_SKUS);
  // Backfill AI tags for any products that still lack tags
  void requestSellerRetag();
  return count;
}

export async function resetInventoryToSeed(): Promise<InventoryItem[]> {
  const seeded = buildSeedItems();
  await writeAll(seeded);
  return seeded;
}
