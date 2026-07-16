import { API_BASE, fetchWithTimeout } from '@/services/apiBase';

export interface ShopRequest {
  id: number;
  session_id: string;
  item_query: string;
  notes?: string | null;
  status: string;
  created_at?: string | null;
}

export async function fetchShopRequests(status = 'open'): Promise<ShopRequest[]> {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/shop/requests?status=${encodeURIComponent(status)}&limit=50`,
      undefined,
      5000,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.requests) ? data.requests : [];
  } catch {
    return [];
  }
}

export async function fulfillShopRequest(id: number): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/shop/requests/${id}/fulfill`,
      { method: 'POST' },
      5000,
    );
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

function formatWhen(iso?: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export { formatWhen };
