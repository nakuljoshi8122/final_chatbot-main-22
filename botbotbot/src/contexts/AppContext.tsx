import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchStores, ShopStore } from '@/services/storesApi';

export type AppRole = 'seller' | 'buyer';

type AppContextValue = {
  ready: boolean;
  role: AppRole | null;
  setRole: (role: AppRole | null) => Promise<void>;
  stores: ShopStore[];
  refreshStores: (category?: string) => Promise<ShopStore[]>;
  selectedStore: ShopStore | null;
  selectStore: (store: ShopStore | null) => Promise<void>;
};

const ROLE_KEY = '@app_role';
const STORE_KEY = '@app_selected_shop';

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [role, setRoleState] = useState<AppRole | null>(null);
  const [stores, setStores] = useState<ShopStore[]>([]);
  const [selectedStore, setSelectedStore] = useState<ShopStore | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [r, s] = await Promise.all([
          AsyncStorage.getItem(ROLE_KEY),
          AsyncStorage.getItem(STORE_KEY),
        ]);
        if (cancelled) return;
        if (r === 'seller' || r === 'buyer') setRoleState(r);
        if (s) {
          try {
            setSelectedStore(JSON.parse(s));
          } catch {
            // ignore
          }
        }
      } finally {
        // Never block the start screen on network — mark ready after local storage only
        if (!cancelled) setReady(true);
      }

      // Prefetch stores in background (short timeout inside fetchStores)
      void fetchStores().then((list) => {
        if (!cancelled) setStores(list);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setRole = useCallback(async (next: AppRole | null) => {
    setRoleState(next);
    if (next) await AsyncStorage.setItem(ROLE_KEY, next);
    else await AsyncStorage.removeItem(ROLE_KEY);
  }, []);

  const refreshStores = useCallback(async (category?: string) => {
    const list = await fetchStores(category);
    setStores(list);
    return list;
  }, []);

  const selectStore = useCallback(async (store: ShopStore | null) => {
    setSelectedStore(store);
    if (store) await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
    else await AsyncStorage.removeItem(STORE_KEY);
  }, []);

  const value = useMemo(
    () => ({
      ready,
      role,
      setRole,
      stores,
      refreshStores,
      selectedStore,
      selectStore,
    }),
    [ready, role, setRole, stores, refreshStores, selectedStore, selectStore],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
