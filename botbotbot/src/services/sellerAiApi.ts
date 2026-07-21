import { API_BASE, fetchWithTimeout } from '@/services/apiBase';

export type AiMorningBrief = {
  ok?: boolean;
  stats?: { lowStock: number; drafts: number; queries: number };
  narrative?: string;
  priorities?: {
    sku: string;
    name: string;
    quantity: number;
    waitlist: number;
    reason: string;
  }[];
};

export type AiListingDraft = {
  ok?: boolean;
  name?: string;
  description?: string;
  category?: string;
  suggested_price?: number;
  suggested_quantity?: number;
  error?: string;
};

export type AiPricing = {
  ok?: boolean;
  suggested_price?: number;
  current_price?: number;
  category_average?: number;
  rationale?: string;
};

export type AiPromoCopy = {
  ok?: boolean;
  tagline?: string;
  description?: string;
  social?: string;
};

export type AiBuyerIntent = {
  ok?: boolean;
  themes?: { label: string; count: number }[];
  tip?: string;
  open_count?: number;
};

async function getJson<T>(url: string, init?: RequestInit, timeout = 12000): Promise<T | null> {
  try {
    const res = await fetchWithTimeout(url, init, timeout);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchAiMorningBrief(storeId: string): Promise<AiMorningBrief | null> {
  return getJson(
    `${API_BASE}/seller/ai/morning-brief?store_id=${encodeURIComponent(storeId)}`,
  );
}

export async function fetchAiQueryDraft(
  storeId: string,
  question: string,
  notes = '',
  targetLanguage = '',
): Promise<{ draft?: string; draft_en?: string } | null> {
  return getJson(`${API_BASE}/seller/ai/query-draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      store_id: storeId,
      question,
      notes,
      target_language: targetLanguage,
    }),
  });
}

export async function fetchAiListingFromImage(
  imageBase64: string,
  storeId: string,
  category: string,
): Promise<AiListingDraft | null> {
  return getJson(
    `${API_BASE}/seller/ai/listing-from-image`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: imageBase64,
        store_id: storeId,
        category,
      }),
    },
    20000,
  );
}

export async function fetchAiPricing(
  storeId: string,
  sku: string,
): Promise<AiPricing | null> {
  return getJson(
    `${API_BASE}/seller/ai/pricing-suggestion?store_id=${encodeURIComponent(storeId)}&sku=${encodeURIComponent(sku)}`,
  );
}

export async function fetchAiPromoCopy(
  name: string,
  category: string,
  storeName: string,
): Promise<AiPromoCopy | null> {
  return getJson(`${API_BASE}/seller/ai/promo-copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, category, store_name: storeName, promo: '10% off' }),
  });
}

export async function fetchAiBuyerIntent(storeId: string): Promise<AiBuyerIntent | null> {
  return getJson(
    `${API_BASE}/seller/ai/buyer-intent?store_id=${encodeURIComponent(storeId)}`,
  );
}

export async function fetchAiStoreAnalytics(
  storeId: string,
  question: string,
): Promise<{ answer?: string } | null> {
  return getJson(`${API_BASE}/seller/ai/store-analytics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ store_id: storeId, question }),
  });
}

export async function fetchAiBatchPhotos(
  images: { base64: string }[],
  category: string,
): Promise<{
  tip?: string;
  duplicate_groups?: { product_type: string; indices: number[] }[];
  items?: { index: number; name: string; product_type: string }[];
} | null> {
  return getJson(`${API_BASE}/seller/ai/batch-photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images, category }),
  }, 45000);
}

export async function translateReplyText(
  text: string,
  targetLanguage: string,
): Promise<{ translated?: string } | null> {
  return getJson(`${API_BASE}/seller/ai/translate-reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, target_language: targetLanguage }),
  });
}
