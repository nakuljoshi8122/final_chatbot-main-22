import { API_BASE, fetchWithTimeout } from '@/services/apiBase';

export type StoreCategory = 'Skincare' | 'Apparel' | 'Handicrafts';

export type ShopStore = {
  id: string;
  name: string;
  owner_name: string;
  owner_email?: string;
  owner_phone?: string;
  category: StoreCategory | string;
  description?: string;
  address?: string;
  created_at?: string;
};

export type StoreQuery = {
  id: string;
  store_id: string;
  question: string;
  notes?: string;
  session_id?: string;
  status: string;
  answer?: string;
  created_at?: string;
};

export async function fetchStores(category?: string): Promise<ShopStore[]> {
  try {
    const q = category ? `?category=${encodeURIComponent(category)}` : '';
    const res = await fetchWithTimeout(`${API_BASE}/stores${q}`, undefined, 5000);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.stores) ? data.stores : [];
  } catch {
    return [];
  }
}

export async function createStore(payload: {
  name: string;
  owner_name: string;
  category: string;
  owner_email?: string;
  owner_phone?: string;
  description?: string;
  address?: string;
}): Promise<{ ok: boolean; store?: ShopStore; error?: string }> {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/stores`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      8000,
    );
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}` };
    }
    return data;
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return {
      ok: false,
      error: aborted
        ? `Server timed out. Check API at ${API_BASE}`
        : `Cannot reach ${API_BASE}. Is the backend running on this Wi‑Fi IP?`,
    };
  }
}

export async function fetchStoreQueries(
  storeId: string,
  status = 'open',
): Promise<StoreQuery[]> {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/stores/${encodeURIComponent(storeId)}/queries?status=${encodeURIComponent(status)}`,
      undefined,
      5000,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.queries) ? data.queries : [];
  } catch {
    return [];
  }
}

export async function answerStoreQuery(
  storeId: string,
  queryId: string,
  answer: string,
): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/stores/${encodeURIComponent(storeId)}/queries/${encodeURIComponent(queryId)}/answer`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
      },
      8000,
    );
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.ok;
  } catch {
    return false;
  }
}

export async function fetchStoreProducts(storeId: string, activeOnly = false) {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/seller/products?store_id=${encodeURIComponent(storeId)}&active_only=${activeOnly}`,
      undefined,
      5000,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.products) ? data.products : [];
  } catch {
    return [];
  }
}

export type ApiSellerProduct = {
  sku: string;
  name: string;
  category?: string;
  price?: string;
  description?: string;
  category_notes?: string;
  quantity?: number;
  status?: string;
  img?: string;
  url?: string;
  store_id?: string;
};

export async function fetchSellerProduct(
  sku: string,
  storeId?: string,
): Promise<ApiSellerProduct | null> {
  try {
    const q = storeId
      ? `?store_id=${encodeURIComponent(storeId)}&active_only=false`
      : '?active_only=false';
    const res = await fetchWithTimeout(`${API_BASE}/seller/products${q}`, undefined, 5000);
    if (!res.ok) return null;
    const data = await res.json();
    const products: ApiSellerProduct[] = Array.isArray(data.products) ? data.products : [];
    const key = sku.trim().toUpperCase();
    return products.find((p) => String(p.sku || '').toUpperCase() === key) || null;
  } catch {
    return null;
  }
}

export { API_BASE };
