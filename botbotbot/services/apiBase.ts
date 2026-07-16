/** Shared API base + timed fetch so a bad IP never freezes the UI. */

export const API_BASE = (
  process.env.EXPO_PUBLIC_API_URL || 'http://192.168.1.36:8000'
).replace(/\/$/, '');

export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = 8000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
