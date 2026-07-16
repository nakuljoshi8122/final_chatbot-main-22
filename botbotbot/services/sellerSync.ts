/** Push seller-uploaded inventory items to the ADK API (AI tags on server). */
import * as FileSystem from 'expo-file-system/legacy';
import type { InventoryItem } from '@/services/inventoryStore';

const API_BASE = (process.env.EXPO_PUBLIC_API_URL || 'http://192.168.1.9:8000').replace(
  /\/$/,
  '',
);

async function imageToBase64(uri?: string): Promise<string | undefined> {
  if (!uri) return undefined;
  if (uri.startsWith('http://') || uri.startsWith('https://')) return undefined;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return undefined;
    return await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch {
    return undefined;
  }
}

export async function syncSellerProductToApi(
  item: InventoryItem,
  opts?: { forceRetag?: boolean },
): Promise<boolean> {
  try {
    const image_base64 = await imageToBase64(item.imageUri);
    const body: Record<string, unknown> = {
      sku: item.sku,
      name: item.name,
      category: item.category,
      price: item.price,
      description: item.description,
      category_notes: item.categoryNotes,
      quantity: item.quantity,
      status: item.status,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
      force_retag: !!opts?.forceRetag,
    };
    if (image_base64) {
      body.image_base64 = image_base64;
    } else if (item.imageUri && /^https?:\/\//i.test(item.imageUri)) {
      body.image_url = item.imageUri;
      body.url = item.imageUri;
    }

    const res = await fetch(`${API_BASE}/seller/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data?.ok;
  } catch {
    return false;
  }
}

export async function removeSellerProductFromApi(sku: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/seller/products/${encodeURIComponent(sku)}`, {
      method: 'DELETE',
    });
  } catch {
    // non-blocking
  }
}

export async function requestSellerRetag(): Promise<void> {
  try {
    await fetch(`${API_BASE}/seller/products/retag?force=false`, { method: 'POST' });
  } catch {
    // non-blocking
  }
}

/**
 * Sync only seller-origin listings (manual uploads), not the 60 Pinterest seed SKUs.
 * Seed/Pinterest products stay in fake_kb.md and remain searchable in chat.
 */
export async function syncSellerItemsToApi(
  items: InventoryItem[],
  seedSkus: Set<string>,
): Promise<number> {
  let ok = 0;
  for (const item of items) {
    const isSeed = seedSkus.has(item.sku);
    const isSeller = item.source === 'seller' || (!isSeed && item.source !== 'seed');
    if (!isSeller) continue;

    if (item.status === 'trash') {
      await removeSellerProductFromApi(item.sku);
      continue;
    }
    if (await syncSellerProductToApi(item)) ok += 1;
  }
  return ok;
}
