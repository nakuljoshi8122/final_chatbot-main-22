// API service
import * as FileSystem from 'expo-file-system/legacy';
import { parseAgentResponse, TileProduct, ChatTable } from '@/utils/parseTiles';

export interface TileMeta {
  has_more: boolean;
  total_available?: number;
}

export interface CommerceMeta {
  show_checkout: boolean;
  checkout_url?: string;
}

export interface ChatMessage {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
  isVoiceMessage?: boolean;
  audioUri?: string;
  transcribedText?: string;
  tiles?: TileProduct[];
  tables?: ChatTable[];
  tileMeta?: TileMeta;
  commerceMeta?: CommerceMeta;
}

export interface ChatResponse {
  answer: string;
  session_id: string;
  transcribed_text?: string;
  audio_response?: string;
  tile_meta?: TileMeta;
  commerce_meta?: CommerceMeta;
}

export interface HealthResponse {
  status: string;
  api_configured?: boolean;
  llm_provider?: string;
  agent_mode?: string;
}

export interface UserQuery {
  query: string;
  session_id?: string;
}

export interface SessionHistoryMessage {
  role: string;
  content: string;
  display?: string;
  ts?: string;
}

export interface SessionHistoryResponse {
  session_id: string;
  messages: SessionHistoryMessage[];
  cart: unknown[];
}

class ApiService {
  private baseURL: string;

  constructor(baseURL?: string) {
    this.baseURL = baseURL || process.env.EXPO_PUBLIC_API_URL || 'http://192.168.0.155:8000';
  }

  async checkHealth(): Promise<HealthResponse> {
    try {
      const response = await fetch(`${this.baseURL}/health`, { method: 'GET' });
      if (!response.ok) return { status: 'error', api_configured: false };
      return await response.json();
    } catch {
      return { status: 'unreachable', api_configured: false };
    }
  }

  async setActiveProduct(sessionId: string, productId: string): Promise<void> {
    try {
      await fetch(`${this.baseURL}/session/active-product`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, product_id: productId }),
      });
    } catch {
      // non-blocking — cart context still works from last shown tiles
    }
  }

  async getSessionHistory(sessionId: string): Promise<SessionHistoryResponse | null> {
    try {
      const response = await fetch(`${this.baseURL}/session/${encodeURIComponent(sessionId)}/history`);
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  async sendMessage(query: string, sessionId?: string): Promise<ChatResponse & { tiles: TileProduct[]; tables: ChatTable[]; displayText: string }> {
    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), 60000);
      });

      const fetchPromise = fetch(`${this.baseURL}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, session_id: sessionId }),
      });

      const response = await Promise.race([fetchPromise, timeoutPromise]) as Response;

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: ChatResponse = await response.json();
      const { text, tiles, tables } = parseAgentResponse(data.answer);
      return {
        ...data,
        tiles,
        tables,
        displayText: text,
        tile_meta: data.tile_meta,
        commerce_meta: data.commerce_meta,
      };
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage === 'Request timeout') {
        throw new Error('Server is taking too long. Try again or ask a shorter question.');
      }
      if (errorMessage === 'Network request failed') {
        throw new Error('Cannot reach server. Check backend is running.');
      }
      throw new Error('Request failed. Try again.');
    }
  }

  async sendVoiceMessage(audioUri: string, sessionId?: string, returnAudio: boolean = false): Promise<ChatResponse & { tiles: TileProduct[]; tables: ChatTable[]; displayText: string }> {
    try {
      if (!audioUri || audioUri === 'null' || audioUri === 'undefined') {
        throw new Error('Invalid audio URI provided');
      }

      const fileInfo = await FileSystem.getInfoAsync(audioUri);
      if (!fileInfo.exists) throw new Error('Audio file does not exist');
      if (!('size' in fileInfo) || !fileInfo.size) throw new Error('Audio file is empty');

      const formData = new FormData();
      const fileExtension = audioUri.includes('.m4a') ? '.m4a' : '.wav';
      formData.append('audio_file', {
        uri: audioUri,
        type: `audio/${fileExtension.substring(1)}`,
        name: `recording${fileExtension}`,
      } as any);

      if (sessionId) formData.append('session_id', sessionId);
      formData.append('return_audio', returnAudio.toString());

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), 30000);
      });

      const fetchPromise = fetch(`${this.baseURL}/ask_voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data' },
        body: formData,
      });

      const response = await Promise.race([fetchPromise, timeoutPromise]) as Response;
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const data: ChatResponse = await response.json();
      const { text, tiles, tables } = parseAgentResponse(data.answer);
      return {
        ...data,
        tiles,
        tables,
        displayText: text,
        tile_meta: data.tile_meta,
        commerce_meta: data.commerce_meta,
      };
    } catch (error) {
      console.error('Error sending voice message:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage === 'Request timeout' || errorMessage === 'Network request failed') {
        throw new Error('Cannot reach server.');
      }
      throw new Error(`Voice failed: ${errorMessage}`);
    }
  }

  generateSessionId(): string {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  async getProduct(productId: string) {
    try {
      const response = await fetch(`${this.baseURL}/products/${encodeURIComponent(productId)}`);
      if (!response.ok) return null;
      const data = await response.json();
      if (data.error) return null;
      return data;
    } catch {
      return null;
    }
  }
}

export const apiService = new ApiService();
