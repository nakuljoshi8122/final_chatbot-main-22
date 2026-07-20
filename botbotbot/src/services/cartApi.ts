import { API_BASE, fetchWithTimeout } from '@/services/apiBase';
import { getBuyerId } from '@/services/buyerId';

export type CartItem = {
  sku: string;
  name: string;
  price: string;
  img?: string;
  url?: string;
  category?: string;
  store_id?: string;
  qty: number;
  available?: number;
  added_at?: string;
};

export type Cart = {
  buyer_id: string;
  items: CartItem[];
  count: number;
  subtotal: number;
  updated_at?: string;
};

export type CartResult = { ok: boolean; error?: string; cart?: Cart };
export type OrderResult = { ok: boolean; error?: string; order?: any; cart?: Cart };

const EMPTY: Cart = { buyer_id: '', items: [], count: 0, subtotal: 0 };

async function postJson(path: string, body: Record<string, unknown>, timeout = 8000) {
  const res = await fetchWithTimeout(
    `${API_BASE}${path}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    timeout,
  );
  return res.json();
}

export async function fetchCart(): Promise<Cart> {
  try {
    const buyerId = await getBuyerId();
    const res = await fetchWithTimeout(
      `${API_BASE}/cart?buyer_id=${encodeURIComponent(buyerId)}`,
      undefined,
      6000,
    );
    if (!res.ok) return EMPTY;
    const data = await res.json();
    return { ...EMPTY, ...data };
  } catch {
    return EMPTY;
  }
}

export async function addToCartApi(
  sku: string,
  storeId?: string,
  qty = 1,
): Promise<CartResult> {
  try {
    const buyer_id = await getBuyerId();
    return await postJson('/cart/add', { buyer_id, sku, store_id: storeId, qty });
  } catch {
    return { ok: false, error: 'network' };
  }
}

export async function updateCartQtyApi(sku: string, qty: number): Promise<CartResult> {
  try {
    const buyer_id = await getBuyerId();
    return await postJson('/cart/update', { buyer_id, sku, qty });
  } catch {
    return { ok: false, error: 'network' };
  }
}

export async function removeFromCartApi(sku: string): Promise<CartResult> {
  try {
    const buyer_id = await getBuyerId();
    return await postJson('/cart/remove', { buyer_id, sku });
  } catch {
    return { ok: false, error: 'network' };
  }
}

export async function clearCartApi(): Promise<CartResult> {
  try {
    const buyer_id = await getBuyerId();
    return await postJson('/cart/clear', { buyer_id });
  } catch {
    return { ok: false, error: 'network' };
  }
}

export async function checkoutApi(): Promise<OrderResult> {
  try {
    const buyer_id = await getBuyerId();
    return await postJson('/cart/checkout', { buyer_id });
  } catch {
    return { ok: false, error: 'network' };
  }
}

export async function buyNowApi(
  sku: string,
  storeId?: string,
  qty = 1,
): Promise<OrderResult> {
  try {
    const buyer_id = await getBuyerId();
    return await postJson('/buy-now', { buyer_id, sku, store_id: storeId, qty });
  } catch {
    return { ok: false, error: 'network' };
  }
}

export async function notifySubscribeApi(sku: string, storeId?: string): Promise<{ ok: boolean }> {
  try {
    const buyer_id = await getBuyerId();
    return await postJson('/notify/subscribe', { buyer_id, sku, store_id: storeId });
  } catch {
    return { ok: false };
  }
}
