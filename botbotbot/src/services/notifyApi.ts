import { API_BASE, fetchWithTimeout } from '@/services/apiBase';

export async function fetchNotifyCount(sku: string): Promise<number> {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/notify/count?sku=${encodeURIComponent(sku)}`,
      undefined,
      5000,
    );
    if (!res.ok) return 0;
    const data = await res.json();
    return Number(data?.count || 0);
  } catch {
    return 0;
  }
}

export async function broadcastNotify(sku: string, storeId?: string): Promise<{ notified: number; message?: string }> {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/notify/broadcast`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku, store_id: storeId || '' }),
      },
      12000,
    );
    if (!res.ok) return { notified: 0 };
    const data = await res.json();
    return { notified: Number(data?.notified || 0), message: data?.message };
  } catch {
    return { notified: 0 };
  }
}
