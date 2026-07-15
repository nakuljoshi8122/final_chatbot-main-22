import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_KEY = '@adidas_chat_session_id';

export async function loadStoredSessionId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export async function saveStoredSessionId(sessionId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SESSION_KEY, sessionId);
  } catch {
    // non-blocking
  }
}

export async function clearStoredSessionId(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SESSION_KEY);
  } catch {
    // non-blocking
  }
}
