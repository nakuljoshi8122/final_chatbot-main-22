import AsyncStorage from '@react-native-async-storage/async-storage';

const BUYER_ID_KEY = '@buyer_device_id';

let cached: string | null = null;

function makeId(): string {
  return `buyer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Stable per-device buyer id. There is no login in this app, so the cart is
 * keyed to this persistent id which survives restarts until storage is cleared.
 */
export async function getBuyerId(): Promise<string> {
  if (cached) return cached;
  try {
    const stored = await AsyncStorage.getItem(BUYER_ID_KEY);
    if (stored) {
      cached = stored;
      return stored;
    }
  } catch {
    // fall through to create a fresh id
  }
  const id = makeId();
  cached = id;
  try {
    await AsyncStorage.setItem(BUYER_ID_KEY, id);
  } catch {
    // non-fatal: id still works for this session
  }
  return id;
}
