import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Cart,
  CartResult,
  OrderResult,
  addToCartApi,
  buyNowApi,
  checkoutApi,
  clearCartApi,
  fetchCart,
  removeFromCartApi,
  updateCartQtyApi,
} from '@/services/cartApi';

type CartContextValue = {
  cart: Cart;
  count: number;
  refresh: () => Promise<void>;
  add: (sku: string, storeId?: string, qty?: number) => Promise<CartResult>;
  updateQty: (sku: string, qty: number) => Promise<CartResult>;
  remove: (sku: string) => Promise<CartResult>;
  clear: () => Promise<CartResult>;
  checkout: () => Promise<OrderResult>;
  buyNow: (sku: string, storeId?: string, qty?: number) => Promise<OrderResult>;
};

const EMPTY: Cart = { buyer_id: '', items: [], count: 0, subtotal: 0 };

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<Cart>(EMPTY);

  const refresh = useCallback(async () => {
    const next = await fetchCart();
    setCart(next);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const applyResult = useCallback((res: CartResult | OrderResult) => {
    if (res && 'cart' in res && res.cart) setCart(res.cart);
  }, []);

  const add = useCallback(
    async (sku: string, storeId?: string, qty = 1) => {
      const res = await addToCartApi(sku, storeId, qty);
      applyResult(res);
      return res;
    },
    [applyResult],
  );

  const updateQty = useCallback(
    async (sku: string, qty: number) => {
      const res = await updateCartQtyApi(sku, qty);
      applyResult(res);
      return res;
    },
    [applyResult],
  );

  const remove = useCallback(
    async (sku: string) => {
      const res = await removeFromCartApi(sku);
      applyResult(res);
      return res;
    },
    [applyResult],
  );

  const clear = useCallback(async () => {
    const res = await clearCartApi();
    applyResult(res);
    return res;
  }, [applyResult]);

  const checkout = useCallback(async () => {
    const res = await checkoutApi();
    applyResult(res);
    return res;
  }, [applyResult]);

  const buyNow = useCallback(
    async (sku: string, storeId?: string, qty = 1) => {
      const res = await buyNowApi(sku, storeId, qty);
      // buy-now doesn't change the saved cart, but stock changed elsewhere.
      return res;
    },
    [],
  );

  const value = useMemo(
    () => ({
      cart,
      count: cart.count || 0,
      refresh,
      add,
      updateQty,
      remove,
      clear,
      checkout,
      buyNow,
    }),
    [cart, refresh, add, updateQty, remove, clear, checkout, buyNow],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
