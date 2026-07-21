/** Shared API base + timed fetch so a bad IP never freezes the UI. */

export const API_BASE = (
  process.env.EXPO_PUBLIC_API_URL || 'http://192.168.0.135:8000'
).replace(/\/$/, '');

/**
 * Point `/product-images/...` at the current Expo API host.
 * Catalog/chat payloads often embed a stale LAN IP from when the product was saved.
 */
export function rewriteProductImageUrl(url: string): string {
  const u = String(url || '').trim();
  if (!u || !API_BASE) return u;
  const pathMatch = u.match(/\/product-images\/[^?\s#]+/i);
  if (pathMatch) return `${API_BASE}${pathMatch[0]}`;
  if (u.startsWith('/product-images/')) return `${API_BASE}${u}`;
  return u;
}

export function normalizeProductImages<T extends { img?: string; images?: string[]; url?: string }>(
  product: T,
): T {
  const img = product.img ? rewriteProductImageUrl(product.img) : product.img;
  const images = Array.isArray(product.images)
    ? product.images.map(rewriteProductImageUrl).filter(Boolean)
    : product.images;
  const url =
    product.url && String(product.url).includes('/product-images/')
      ? rewriteProductImageUrl(product.url)
      : product.url;
  return { ...product, img, images, url };
}

export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = 8000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
