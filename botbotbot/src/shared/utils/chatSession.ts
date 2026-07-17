import AsyncStorage from '@react-native-async-storage/async-storage';

function sessionKey(storeId?: string | null): string {
  return storeId ? `@chat_session_${storeId}` : '@shopassist_chat_session_id';
}

export async function loadStoredSessionId(storeId?: string | null): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(sessionKey(storeId));
  } catch {
    return null;
  }
}

export async function saveStoredSessionId(
  sessionId: string,
  storeId?: string | null,
): Promise<void> {
  try {
    await AsyncStorage.setItem(sessionKey(storeId), sessionId);
  } catch {
    // non-blocking
  }
}

export async function clearStoredSessionId(storeId?: string | null): Promise<void> {
  try {
    await AsyncStorage.removeItem(sessionKey(storeId));
  } catch {
    // non-blocking
  }
}
