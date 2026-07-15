import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { useScreenInsets } from '@/hooks/useScreenInsets';
import { Colors } from '../constants/Colors';
import { useColorScheme } from '../hooks/useColorScheme';
import { useVoiceRecognition } from '../hooks/useVoiceRecognition';
import { useVoicePlayback } from '../hooks/useVoicePlayback';
import { apiService } from '../services/api-fetch';

interface ChatMessage {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: number;
  isVoiceMessage?: boolean;
  audioUri?: string;
}

interface ConversationalVoiceScreenProps {
  onClose: () => void;
}

const { width } = Dimensions.get('window');

export default function ConversationalVoiceScreen({ onClose }: ConversationalVoiceScreenProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [conversationActive, setConversationActive] = useState(false);
  const [isStartingConversation, setIsStartingConversation] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  const scrollViewRef = useRef<ScrollView>(null);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { headerPaddingTop, inputBottomPadding } = useScreenInsets();

  const {
    isListening,
    isProcessing,
    isInitialized,
    error: voiceError,
    transcript,
    startListening,
    stopListening,
    reset: resetVoice,
  } = useVoiceRecognition(sessionId || undefined);

  const {
    isPlaying: isPlaybackPlaying,
    isPaused: isPlaybackPaused,
    playAudio,
    stopAudio,
  } = useVoicePlayback();

  // Auto-start conversation when voice recognition is ready
  useEffect(() => {
    if (isInitialized && !conversationActive && !isStartingConversation && messages.length === 0) {
      console.log('🎤 Voice recognition ready, starting conversation...');
      startConversation();
    }
  }, [isInitialized, conversationActive, isStartingConversation, messages.length]);

  // Handle speech results
  useEffect(() => {
    if (transcript && conversationActive) {
      console.log('🎤 Processing transcript:', transcript);
      // Add a small delay to ensure conversation state is stable
      setTimeout(() => {
        if (conversationActive) {
          console.log('🎤 Delayed processing transcript:', transcript);
          processVoiceInput(transcript);
        } else {
          console.log('🎤 Conversation no longer active, skipping processing');
        }
      }, 100);
    }
  }, [transcript, conversationActive]);

  // Auto-continue conversation after bot responds
  useEffect(() => {
    if (conversationActive && !isSpeaking && !isProcessing && !isSendingMessage && !isListening && messages.length > 0) {
      console.log('🎤 Auto-continuing conversation...');
      console.log('🎤 Current state check:', { conversationActive, isSpeaking, isProcessing, isListening, messagesCount: messages.length });
      setTimeout(() => {
        if (conversationActive) { // Double-check conversation is still active
          console.log('🎤 Actually starting listening...');
          startListening();
        }
      }, 2000); // Increased delay to allow speech to complete
    }
  }, [conversationActive, isSpeaking, isProcessing, isSendingMessage, isListening, messages.length]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  const startConversation = async () => {
    if (conversationActive || isStartingConversation) {
      console.log('🎤 Conversation already active or starting');
      return;
    }

    console.log('🎤 Starting conversation...');
    setIsStartingConversation(true);
    setConversationActive(true);
    
    // Create a new session ID for this conversation
    const newSessionId = `voice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setSessionId(newSessionId);
    console.log('🎤 Created session ID:', newSessionId);
    
    try {
      await startListening();
      console.log('🎤 Conversation started successfully');
    } catch (error) {
      console.error('Error starting conversation:', error);
      setConversationActive(false);
    } finally {
      setIsStartingConversation(false);
    }
  };

  const processVoiceInput = async (text: string) => {
    console.log('🤖 processVoiceInput called with:', text);
    console.log('🤖 conversationActive:', conversationActive);
    
    if (!conversationActive) {
      console.log('🤖 Conversation not active, skipping processing');
      return;
    }
    
    console.log('🤖 Processing voice input:', text);
    console.log('🤖 Current conversation state:', { conversationActive, isSpeaking, isProcessing, isListening });
    setIsSendingMessage(true);
    
    // Add user message
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      text: text,
      isUser: true,
      timestamp: Date.now(),
    };
    
    console.log('🤖 Adding user message to chat');
    setMessages(prev => [...prev, userMessage]);
    
    try {
      console.log('🤖 Sending text to backend with session ID:', sessionId);
      // Send text to backend with session ID for context
      const response = await apiService.sendMessage(text, sessionId || undefined);
      console.log('🤖 Backend response received:', response);
      
      if (response.answer) {
        console.log('🤖 Adding bot message to chat');
        // Add bot message
        const botMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          text: response.answer,
          isUser: false,
          timestamp: Date.now(),
        };
        
        setMessages(prev => [...prev, botMessage]);
        
        console.log('🤖 About to call speakResponse with:', response.answer);
        // Speak the response using backend audio if available, otherwise use text
        if (response.audio_response) {
          console.log('🤖 Using backend audio response');
          await speakAudioResponse(response.audio_response);
        } else {
          console.log('🤖 Using text-to-speech fallback');
          await speakResponse(response.answer);
        }
        console.log('🤖 speakResponse call completed');
      } else {
        console.error('❌ Backend error - no answer field:', response);
        const errorMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          text: 'Sorry, I encountered an error. Please try again.',
          isUser: false,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    } catch (error) {
      console.error('❌ Error processing voice input:', error);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: 'Sorry, I encountered an error. Please try again.',
        isUser: false,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      console.log('🤖 Setting isProcessing to false');
      setIsSendingMessage(false);
      
      // Don't reset voice here - let the auto-continue handle it
      // resetVoice();
    }
  };

  const speakAudioResponse = async (audioBase64: string) => {
    try {
      console.log('🔊 Speaking audio response from backend');
      console.log('🔊 Audio data length:', audioBase64.length);
      setIsSpeaking(true);
      
      // Convert base64 to audio file
      const FileSystem = await import('expo-file-system/legacy');
      const audioUri = `${FileSystem.cacheDirectory}response_${Date.now()}.mp3`;
      
      console.log('🔊 Saving audio file to:', audioUri);
      await FileSystem.writeAsStringAsync(audioUri, audioBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      
      console.log('🔊 Playing audio file...');
      await playAudio(audioUri);
      console.log('🔊 Audio playback started');
      
    } catch (error) {
      console.error('❌ Error playing audio response:', error);
      setIsSpeaking(false);
    }
  };

  const speakResponse = async (text: string) => {
    try {
      console.log('🔊 Speaking response:', text);
      console.log('🔊 Current conversation state:', { conversationActive, isSpeaking, isProcessing, isListening });
      setIsSpeaking(true);
      
      // Use expo-speech for simple TTS
      console.log('🔊 Starting speech...');
      Speech.speak(text, {
        language: 'en-US',
        pitch: 1.0,
        rate: 0.9,
        volume: 1.0,
        onDone: () => {
          console.log('🔊 Speech completed successfully');
          setIsSpeaking(false);
        },
        onError: (speechError: Error) => {
          console.error('🔊 Speech error:', speechError);
          setIsSpeaking(false);
        },
        onStart: () => {
          console.log('🔊 Speech started');
        },
        onStopped: () => {
          console.log('🔊 Speech stopped');
          setIsSpeaking(false);
        },
      });
      console.log('🔊 Speech.speak() called');
    } catch (error) {
      console.error('❌ Error speaking response:', error);
      setIsSpeaking(false);
    }
  };

  const stopConversation = async () => {
    console.log('🛑 Stopping conversation...');
    
    setConversationActive(false);
    setIsSpeaking(false);
    setIsSendingMessage(false);
    
    // Stop voice recognition
    try {
      await stopListening();
    } catch (error) {
      console.error('Error stopping voice recognition:', error);
    }
    
    // Stop any ongoing speech
    try {
      Speech.stop();
    } catch (error) {
      console.error('Error stopping speech:', error);
    }
    
    // Reset voice recognition
    resetVoice();
  };

  const renderMessage = (message: ChatMessage) => (
    <View
      key={message.id}
      style={[
        styles.messageContainer,
        message.isUser ? styles.userMessage : styles.botMessage,
      ]}
    >
      <Text
        style={[
          styles.messageText,
          message.isUser ? styles.userMessageText : styles.botMessageText,
        ]}
      >
        {message.text}
      </Text>
      <Text style={styles.timestamp}>
        {new Date(message.timestamp).toLocaleTimeString()}
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.background, paddingTop: headerPaddingTop }]}>
        <View style={styles.headerContent}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={onClose}
          >
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Voice Conversation
          </Text>
          <View style={styles.headerSpacer} />
        </View>
      </View>

      {/* Status Indicator */}
      <View style={styles.statusContainer}>
        <View
          style={[
            styles.statusIndicator,
            !isInitialized && styles.initializingIndicator,
            isListening && styles.listeningIndicator,
            (isProcessing || isSendingMessage) && styles.processingIndicator,
            isSpeaking && styles.speakingIndicator,
          ]}
        />
        <Text style={styles.statusText}>
          {!isInitialized ? "🔧 Initializing voice recognition..." :
           isListening ? "🎤 Listening... Speak naturally" : 
           (isProcessing || isSendingMessage) ? "🤖 Processing your message..." : 
           isSpeaking ? "🔊 Speaking..." : 
           conversationActive ? "💬 Ready to chat" : "⏸️ Conversation paused"}
        </Text>
      </View>

      {/* Messages */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.messagesContainer}
        contentContainerStyle={styles.messagesContent}
        showsVerticalScrollIndicator={false}
      >
        {messages.length === 0 && (
          <View style={styles.emptyState}>
            <View style={styles.emptyStateIcon}>
              <Ionicons name="chatbubbles" size={48} color="#8e8e8e" />
            </View>
            <Text style={styles.emptyStateText}>
              Start talking to begin the conversation!
            </Text>
          </View>
        )}
        
        {messages.map(renderMessage)}
      </ScrollView>

      {/* Controls */}
      <View style={[styles.controlsContainer, { paddingBottom: inputBottomPadding }]}>
        {!conversationActive ? (
          <TouchableOpacity
            style={styles.startButton}
            onPress={startConversation}
            disabled={!isInitialized || isStartingConversation}
          >
            <Ionicons name="mic" size={24} color="#fff" />
            <Text style={styles.startButtonText}>Start Talking</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.stopButton}
            onPress={stopConversation}
          >
            <Ionicons name="stop" size={24} color="#fff" />
            <Text style={styles.stopButtonText}>End Chat</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Error Display */}
      {voiceError && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{voiceError}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  headerSpacer: {
    width: 40,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: '#f8f9fa',
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#8e8e8e',
    marginRight: 12,
  },
  initializingIndicator: {
    backgroundColor: '#ffa500',
  },
  listeningIndicator: {
    backgroundColor: '#4caf50',
  },
  processingIndicator: {
    backgroundColor: '#2196f3',
  },
  speakingIndicator: {
    backgroundColor: '#9c27b0',
  },
  statusText: {
    fontSize: 16,
    color: '#333',
    flex: 1,
  },
  messagesContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  messagesContent: {
    paddingVertical: 20,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyStateIcon: {
    marginBottom: 20,
  },
  emptyStateText: {
    fontSize: 16,
    color: '#8e8e8e',
    textAlign: 'center',
  },
  messageContainer: {
    marginBottom: 15,
    maxWidth: '80%',
  },
  userMessage: {
    alignSelf: 'flex-end',
  },
  botMessage: {
    alignSelf: 'flex-start',
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
    padding: 12,
    borderRadius: 18,
  },
  userMessageText: {
    backgroundColor: '#000000',
    color: '#fff',
  },
  botMessageText: {
    backgroundColor: '#f1f3f4',
    color: '#333',
  },
  timestamp: {
    fontSize: 12,
    color: '#8e8e8e',
    marginTop: 4,
    textAlign: 'right',
  },
  controlsContainer: {
    padding: 20,
    alignItems: 'center',
  },
  startButton: {
    backgroundColor: '#4caf50',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 25,
  },
  startButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  stopButton: {
    backgroundColor: '#f44336',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 25,
  },
  stopButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  errorContainer: {
    backgroundColor: '#ffebee',
    padding: 15,
    margin: 20,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#f44336',
  },
  errorText: {
    color: '#c62828',
    fontSize: 14,
  },
});
