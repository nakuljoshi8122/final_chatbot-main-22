import axios from 'axios';

const API_BASE_URL = 'http://192.168.0.155:8000';

export interface ChatMessage {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
}

export interface ChatResponse {
  answer: string;
  session_id: string;
}

export interface UserQuery {
  query: string;
  session_id?: string;
}

class ApiService {
  private baseURL: string;

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL;
  }

  async sendMessage(query: string, sessionId?: string): Promise<ChatResponse> {
    try {
      const response = await axios.post(`${this.baseURL}/ask`, {
        query,
        session_id: sessionId,
      });
      return response.data;
    } catch (error) {
      console.error('Error sending message:', error);
      throw new Error('Failed to send message. Please check if the backend is running.');
    }
  }

  // Generate a unique session ID
  generateSessionId(): string {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }
}

export const apiService = new ApiService();
