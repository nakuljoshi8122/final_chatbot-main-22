import { API_BASE, fetchWithTimeout } from '@/services/apiBase';

/** Quick field patch for lazy in-chat edits (qty / price / status). */
export async function patchSellerProduct(payload: {
  sku: string;
  name: string;
  store_id?: string;
  price?: string;
  quantity?: number;
  status?: string;
  category?: string;
  description?: string;
  img?: string;
  url?: string;
  list_price?: string;
  clear_discount?: boolean;
}): Promise<boolean> {
  try {
    const body: Record<string, unknown> = {
      sku: payload.sku,
      name: payload.name,
      store_id: payload.store_id,
      price: payload.price,
      quantity: payload.quantity,
      status: payload.status,
      category: payload.category,
      description: payload.description,
    };
    if (payload.list_price !== undefined) {
      body.list_price = payload.list_price;
    }
    if (payload.clear_discount) {
      body.clear_discount = true;
    }
    if (payload.img) {
      body.image_url = payload.img;
      body.url = payload.url || payload.img;
    }
    const res = await fetchWithTimeout(
      `${API_BASE}/seller/products`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      12000,
    );
    if (!res.ok) return false;
    const data = await res.json();
    return !!data?.ok;
  } catch {
    return false;
  }
}
