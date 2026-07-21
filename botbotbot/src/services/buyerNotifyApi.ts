import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE, fetchWithTimeout } from '@/services/apiBase';
import { getBuyerId } from '@/services/buyerId';
import type { ApiSellerProduct } from '@/services/storesApi';
import type { CartItem } from '@/services/cartApi';

export type BuyerInboxNotification = {
  id?: string;
  type?: string;
  sku?: string;
  store_id?: string;
  message?: string;
  created_at?: string;
  read?: boolean;
};

export type BuyerAlert = {
  key: string;
  type: 'restock' | 'low_stock' | 'discount';
  title: string;
  message: string;
  sku?: string;
};

const SEEN_KEY = '@buyer_notify_seen_sig';

export async function fetchBuyerInbox(): Promise<BuyerInboxNotification[]> {
  try {
    const buyerId = await getBuyerId();
    const res = await fetchWithTimeout(
      `${API_BASE}/notify/inbox?buyer_id=${encodeURIComponent(buyerId)}`,
      undefined,
      6000,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.notifications) ? data.notifications : [];
  } catch {
    return [];
  }
}

export async function loadBuyerNotifySeenSig(storeId: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(`${SEEN_KEY}_${storeId}`);
    return raw || null;
  } catch {
    return null;
  }
}

export async function saveBuyerNotifySeenSig(storeId: string, sig: string): Promise<void> {
  try {
    await AsyncStorage.setItem(`${SEEN_KEY}_${storeId}`, sig);
  } catch {
    // ignore
  }
}

function parsePrice(value?: string): number {
  if (!value) return 0;
  const n = parseFloat(String(value).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function hasDiscount(p: ApiSellerProduct): boolean {
  const list = parsePrice(p.list_price);
  const sale = parsePrice(p.price);
  return list > 0 && sale > 0 && list > sale;
}

/** Build actionable buyer alerts for one shop — only when something is worth noticing. */
export function buildBuyerAlerts(params: {
  storeId: string;
  inbox: BuyerInboxNotification[];
  products: ApiSellerProduct[];
  cartItems: CartItem[];
}): BuyerAlert[] {
  const { storeId, inbox, products, cartItems } = params;
  const sid = storeId.trim();
  const productBySku = new Map(
    products.map((p) => [String(p.sku || '').toUpperCase(), p]),
  );
  const alerts: BuyerAlert[] = [];
  const seen = new Set<string>();

  const push = (alert: BuyerAlert) => {
    if (seen.has(alert.key)) return;
    seen.add(alert.key);
    alerts.push(alert);
  };

  for (const n of inbox) {
    if (n.read) continue;
    const nStore = String(n.store_id || '').trim();
    if (nStore && nStore !== sid) continue;
    const sku = String(n.sku || '').toUpperCase();
    const p = sku ? productBySku.get(sku) : undefined;
    const name = p?.name || sku || 'Item';
    if (n.type === 'restock' || /back in stock|restocked/i.test(n.message || '')) {
      push({
        key: `restock_${n.id || sku}`,
        type: 'restock',
        title: 'Back in stock',
        message: n.message || `${name} is available again.`,
        sku,
      });
    }
  }

  const storeCart = cartItems.filter(
    (c) => !c.store_id || String(c.store_id) === sid,
  );

  for (const c of storeCart) {
    const sku = String(c.sku || '').toUpperCase();
    const p = productBySku.get(sku);
    const name = p?.name || c.name || sku;
    const qty = p?.quantity ?? c.available;

    if (typeof qty === 'number' && qty > 0 && qty < 3) {
      push({
        key: `low_${sku}`,
        type: 'low_stock',
        title: 'Few left',
        message: `Only ${qty} left of ${name} in your cart.`,
        sku,
      });
    }

    if (p && hasDiscount(p)) {
      push({
        key: `disc_${sku}`,
        type: 'discount',
        title: 'On sale',
        message: `${name} is ${p.list_price} → ${p.price}.`,
        sku,
      });
    }
  }

  return alerts.slice(0, 6);
}

export function buyerAlertSignature(alerts: BuyerAlert[]): string {
  return alerts.map((a) => a.key).sort().join('|');
}
