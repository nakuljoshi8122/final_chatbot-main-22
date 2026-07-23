/** Shared API base + timed fetch so a bad IP never freezes the UI. */

import Constants from 'expo-constants';

/**
 * Prefer the same LAN host Expo Go / Metro is already using.
 * That way when Wi‑Fi DHCP changes the Mac IP, stores/chat still hit :8000
 * without manually editing .env every time.
 */
function lanHostFromExpo(): string | null {
  const candidates = [
    Constants.expoConfig?.hostUri,
    // Expo Go / legacy manifests
    (Constants as { manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } } })
      .manifest2?.extra?.expoGo?.debuggerHost,
    (Constants as { manifest?: { debuggerHost?: string } }).manifest?.debuggerHost,
    Constants.linkingUri,
  ];
  for (const raw of candidates) {
    const s = String(raw || '').trim();
    if (!s) continue;
    // "192.168.1.15:8081" | "exp://192.168.1.15:8081" | "http://192.168.1.15:8081"
    const m = s.match(/(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?/);
    if (m?.[1] && m[1] !== '127.0.0.1') return m[1];
  }
  return null;
}

function resolveApiBase(): string {
  const fromEnv = String(process.env.EXPO_PUBLIC_API_URL || '')
    .trim()
    .replace(/\/$/, '');
  const lan = lanHostFromExpo();
  if (lan) {
    // Keep port from env when present (default 8000).
    const portMatch = fromEnv.match(/:(\d+)\s*$/);
    const port = portMatch?.[1] || '8000';
    return `http://${lan}:${port}`;
  }
  return fromEnv || 'http://192.168.1.15:8000';
}

export const API_BASE = resolveApiBase();

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
