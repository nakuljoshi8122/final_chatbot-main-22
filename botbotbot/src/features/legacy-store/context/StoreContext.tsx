import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getStoreById,
  STORE_STORAGE_KEY,
  STORES,
  StoreConfig,
  StoreId,
} from '@/features/legacy-store/constants/Stores';

type StoreContextValue = {
  store: StoreConfig | null;
  storeId: StoreId | null;
  ready: boolean;
  stores: StoreConfig[];
  selectStore: (id: StoreId) => Promise<void>;
  clearStore: () => Promise<void>;
};

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [storeId, setStoreId] = useState<StoreId | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORE_STORAGE_KEY);
        if (!cancelled && saved && getStoreById(saved)) {
          setStoreId(saved as StoreId);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectStore = useCallback(async (id: StoreId) => {
    setStoreId(id);
    try {
      await AsyncStorage.setItem(STORE_STORAGE_KEY, id);
    } catch {
      // ignore
    }
  }, []);

  const clearStore = useCallback(async () => {
    setStoreId(null);
    try {
      await AsyncStorage.removeItem(STORE_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo<StoreContextValue>(
    () => ({
      store: getStoreById(storeId),
      storeId,
      ready,
      stores: STORES,
      selectStore,
      clearStore,
    }),
    [storeId, ready, selectStore, clearStore],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) {
    throw new Error('useStore must be used within StoreProvider');
  }
  return ctx;
}
