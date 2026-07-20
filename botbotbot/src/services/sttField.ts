import { API_BASE, fetchWithTimeout } from '@/services/apiBase';

/** Transcribe a local audio file via backend /stt (Whisper). */
export async function transcribeAudioFile(uri: string): Promise<string> {
  const form = new FormData();
  const name = uri.split('/').pop() || 'voice.m4a';
  form.append('audio_file', {
    uri,
    name,
    type: 'audio/m4a',
  } as unknown as Blob);

  const res = await fetchWithTimeout(
    `${API_BASE}/stt`,
    { method: 'POST', body: form },
    30000,
  );
  if (!res.ok) throw new Error(`STT failed (${res.status})`);
  const data = await res.json();
  return String(data?.transcribed_text || '').trim();
}
