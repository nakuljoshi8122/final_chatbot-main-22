import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useScreenInsets } from '@/hooks/useScreenInsets';
import * as FileSystem from 'expo-file-system/legacy';
import { apiService, ChatMessage } from '../services/api-fetch';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Colors } from '@/constants/Colors';
import { useVoiceRecording } from '../hooks/useVoiceRecording';
import { useVoicePlayback } from '../hooks/useVoicePlayback';
import VoiceMessage from './VoiceMessage';

interface VoiceConversationScreenProps {
  onClose: () => void;
}

export default function VoiceConversationScreen({ onClose }: VoiceConversationScreenProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState(apiService.generateSessionId());
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [conversationActive, setConversationActive] = useState(false);
  const [conversationStartTime, setConversationStartTime] = useState<number | null>(null);
  const [isStartingConversation, setIsStartingConversation] = useState(false);
  const recordingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [lastSoundTime, setLastSoundTime] = useState<number>(Date.now());
  const [countdown, setCountdown] = useState<number>(0);
  const scrollViewRef = useRef<ScrollView>(null);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { headerPaddingTop, inputBottomPadding } = useScreenInsets();

  // Voice recording hook
  const {
    isRecording,
    isPaused,
    duration,
    recordingUri,
    error: recordingError,
    isInitialized: isAudioInitialized,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    resetRecording,
  } = useVoiceRecording();

  // Voice playback hook
  const {
    isPlaying,
    isPaused: isPlaybackPaused,
    playAudio,
    stopAudio,
  } = useVoicePlayback();

  // Start countdown timer
  const startCountdown = (duration: number) => {
    setCountdown(duration);
    const countdownInterval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          return 0;
        }
        return prev - 1;
      });
    }, 100);
  };

  // Reset silence detection when user interacts
  const resetSilenceDetection = () => {
    console.log('🎤 User interaction detected - extending recording time');
    setLastSoundTime(Date.now());
    
    // Clear existing timeout
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    
    // Start countdown
    startCountdown(10); // 1 second countdown (10 * 100ms)
    
    // Set new timeout
    silenceTimeoutRef.current = setTimeout(() => {
      if (conversationActive && isListening) {
        console.log('🎤 Extended timeout - stopping recording');
        stopRecording().then((uri) => {
          if (uri) {
            console.log('🎤 Extended timeout - processing recorded audio:', uri);
            processVoiceInput(uri);
          } else {
            console.log('🎤 Extended timeout - no audio recorded');
          }
        });
      }
    }, 1000); // 1 second of silence - much faster!
  };

  // Conversational voice flow
  const startConversation = async () => {
    if (conversationActive || isListening || isProcessing || isSpeaking || isStartingConversation) {
      console.log('🎤 Conversation already active or starting, skipping start');
      return;
    }
    
    console.log('🎤 Starting conversation...');
    setIsStartingConversation(true);
    setConversationActive(true);
    setConversationStartTime(Date.now());
    setIsListening(true);
    
    try {
      await startRecording();
      console.log('🎤 Recording started successfully');
      
      // Clear any existing timeout first
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
        recordingTimeoutRef.current = null;
      }
      
      // Set a timeout to stop recording after 20 seconds maximum
      recordingTimeoutRef.current = setTimeout(() => {
        console.log('⏰ Recording timeout - stopping recording');
        if (conversationActive && isListening) {
          stopRecording().then((uri) => {
            if (uri) {
              console.log('⏰ Timeout - processing recorded audio:', uri);
              processVoiceInput(uri);
            } else {
              console.log('⏰ Timeout - no audio recorded');
            }
          });
        }
      }, 20000); // 20 seconds maximum timeout
      
      // Start voice activity detection with a simple timer approach
      // Since we can't easily detect actual voice activity, we'll use a smart timer
      console.log('🎤 Starting smart recording timer...');
      
      // Start countdown for initial recording
      startCountdown(15); // 1.5 seconds countdown (15 * 100ms)
      
      // Set initial silence timeout - much faster response
      silenceTimeoutRef.current = setTimeout(() => {
        if (conversationActive && isListening) {
          console.log('🎤 Smart timer - stopping recording after initial period');
          stopRecording().then((uri) => {
            if (uri) {
              console.log('🎤 Smart timer - processing recorded audio:', uri);
              processVoiceInput(uri);
            } else {
              console.log('🎤 Smart timer - no audio recorded');
            }
          });
        }
      }, 1500); // 1.5 seconds initial timeout - much faster!
      
    } catch (error) {
      console.error('Error starting conversation:', error);
      setConversationActive(false);
      setIsListening(false);
    } finally {
      setIsStartingConversation(false);
    }
  };

  const processVoiceInput = async (audioUri: string) => {
    if (!conversationActive) return;
    
    console.log('🤖 Processing voice input...');
    setIsListening(false);
    setIsProcessing(true);
    setCountdown(0); // Reset countdown
    
    // Clear recording timeout since we're processing input
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    
    try {
      const response = await apiService.sendVoiceMessage(audioUri, sessionId, true);
      console.log('🔊 API response received:', response);
      console.log('🔊 Response keys:', Object.keys(response));
      console.log('🔊 Answer:', response.answer);
      console.log('🔊 Has audio_response:', !!response.audio_response);
      console.log('🔊 Audio response type:', typeof response.audio_response);
      console.log('🔊 Audio response length:', response.audio_response ? response.audio_response.length : 0);
      console.log('🔊 Audio response first 100 chars:', response.audio_response ? response.audio_response.substring(0, 100) : 'N/A');
      
      // Add user message (voice)
      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        text: 'Voice message',
        isUser: true,
        timestamp: new Date(),
        isVoiceMessage: true,
        audioUri: audioUri,
        transcribedText: response.transcribed_text,
      };
      setMessages(prev => [...prev, userMessage]);
      
      // Add bot response
      let botAudioUri: string | undefined = undefined;
      console.log('🔊 Checking for audio response...');
      console.log('Audio response exists:', !!response.audio_response);
      console.log('Audio response type:', typeof response.audio_response);
      console.log('Audio response length:', response.audio_response ? response.audio_response.length : 0);
      
      if (response.audio_response) {
        try {
          const base64Data = response.audio_response;
          const fileName = `bot_response_${Date.now()}.mp3`;
          const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
          
          console.log('🔊 Saving audio to file:', fileUri);
          console.log('🔊 Base64 data length:', base64Data.length);
          console.log('🔊 Base64 data first 50 chars:', base64Data.substring(0, 50));
          
          await FileSystem.writeAsStringAsync(fileUri, base64Data, {
            encoding: FileSystem.EncodingType.Base64,
          });
          
          // Verify the file was created
          const fileInfo = await FileSystem.getInfoAsync(fileUri);
          console.log('🔊 File created successfully:', fileInfo);
          console.log('🔊 File size:', fileInfo.size);
          console.log('🔊 File exists:', fileInfo.exists);
          
          botAudioUri = fileUri;
          console.log('🔊 Audio response saved successfully:', botAudioUri);
        } catch (error) {
          console.error('❌ Error converting audio response:', error);
          console.error('❌ Error details:', error.message);
          console.error('❌ Error stack:', error.stack);
        }
      } else {
        console.log('❌ No audio response received from backend');
      }
      
      const botMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: response.answer,
        isUser: false,
        timestamp: new Date(),
        isVoiceMessage: !!botAudioUri,
        audioUri: botAudioUri,
      };
      
      setMessages(prev => [...prev, botMessage]);
      setSessionId(response.session_id);
      
      // Play audio response and continue conversation
      if (botAudioUri) {
        console.log('🔊 Starting audio playback...');
        console.log('🔊 Audio URI for playback:', botAudioUri);
        
        // Verify file exists before playing
        try {
          const fileInfo = await FileSystem.getInfoAsync(botAudioUri);
          console.log('🔊 File info before playback:', fileInfo);
          console.log('🔊 File exists:', fileInfo.exists);
          console.log('🔊 File size:', fileInfo.size);
        } catch (fileCheckError) {
          console.error('❌ Error checking file before playback:', fileCheckError);
        }
        
        setIsSpeaking(true);
        try {
          await playAudio(botAudioUri);
          console.log('🔊 Audio playback completed');
        } catch (playbackError) {
          console.error('❌ Audio playback error:', playbackError);
          console.error('❌ Playback error details:', playbackError.message);
          console.error('❌ Playback error stack:', playbackError.stack);
        } finally {
          setIsSpeaking(false);
        }
      } else {
        console.log('❌ No audio URI available for playback');
      }
      
      // Continue listening after response
      setTimeout(async () => {
        if (conversationActive && !isStartingConversation) {
          console.log('🔄 Continuing conversation...');
          setIsListening(true);
          // Add a small delay to ensure cleanup is complete
          await new Promise(resolve => setTimeout(resolve, 500));
          startRecording().catch(console.error);
        }
      }, 1500); // Increased delay to ensure proper cleanup
      
    } catch (error) {
      console.error('Error processing voice input:', error);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: `Sorry, I encountered an error: ${error.message || 'Unknown error'}`,
        isUser: false,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsProcessing(false);
      await resetRecording();
    }
  };

  const stopConversation = async () => {
    console.log('🛑 Stopping conversation...');
    console.log('🛑 Stop called from:', new Error().stack);
    
    // Prevent stopping too quickly (less than 2 seconds)
    if (conversationStartTime && Date.now() - conversationStartTime < 2000) {
      console.log('🛑 Conversation stopped too quickly, ignoring stop request');
      return;
    }
    
    setConversationActive(false);
    setConversationStartTime(null);
    setIsListening(false);
    setIsProcessing(false);
    setIsSpeaking(false);
    setCountdown(0); // Reset countdown
    stopAudio();
    
    // Clear all timeouts
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    
    await resetRecording();
  };

  // Auto-start conversation when audio is initialized
  useEffect(() => {
    if (!conversationActive && !isStartingConversation && isAudioInitialized && messages.length === 0) {
      // Add welcome message
      const welcomeMessage: ChatMessage = {
        id: 'welcome',
        text: "Good day. I'm your Adidas Sales Consultant. Please tell me what you're looking for — footwear, apparel, or equipment — and I'll assist you.",
        isUser: false,
        timestamp: new Date(),
      };
      setMessages([welcomeMessage]);
      
      // Start conversation after a short delay
      setTimeout(() => {
        startConversation();
      }, 2000);
    }
  }, [isAudioInitialized, messages.length, conversationActive, isStartingConversation]);

  // Handle recording completion
  useEffect(() => {
    console.log('🔍 Recording completion check:', {
      recordingUri: !!recordingUri,
      conversationActive,
      isListening,
      recordingUriValue: recordingUri
    });
    
    if (recordingUri && conversationActive && isListening) {
      console.log('🎯 Processing voice input with URI:', recordingUri);
      processVoiceInput(recordingUri);
    }
  }, [recordingUri, conversationActive, isListening]);

  const scrollToBottom = () => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
      }
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
    };
  }, []);

  const renderMessage = (message: ChatMessage) => {
    // Render voice message
    if (message.isVoiceMessage && message.audioUri) {
      return (
        <View key={message.id}>
          <VoiceMessage
            isUser={message.isUser}
            audioUri={message.audioUri}
            transcribedText={message.transcribedText}
            timestamp={message.timestamp}
          />
        </View>
      );
    }

    // Render text message
    return (
      <View
        key={message.id}
        style={[
          styles.messageContainer,
          message.isUser ? styles.userMessage : styles.botMessage,
        ]}
      >
        <View
          style={[
            styles.messageBubble,
            message.isUser
              ? styles.userBubble
              : styles.botBubble,
          ]}
        >
          <Text
            style={[
              styles.messageText,
              { color: message.isUser ? 'white' : '#000' },
            ]}
          >
            {message.text}
          </Text>
          <Text
            style={[
              styles.timestamp,
              { color: message.isUser ? 'rgba(255,255,255,0.7)' : '#8e8e8e' },
            ]}
          >
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: headerPaddingTop }]}>
        <View style={styles.headerContent}>
          <View style={styles.profileInfo}>
            <View style={styles.profileImage}>
              <Ionicons name="mic" size={24} color="#fff" />
            </View>
            <View>
              <Text style={styles.profileName}>Voice Assistant</Text>
              <Text style={styles.profileStatus}>Conversational Mode</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Messages */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.messagesContainer}
        contentContainerStyle={styles.messagesContent}
        showsVerticalScrollIndicator={false}
        onTouchStart={() => {
          // Reset silence timer when user touches screen (simulating voice activity)
          if (conversationActive && isListening) {
            console.log('🎤 Touch detected - extending recording time');
            resetSilenceDetection();
          }
        }}
      >
        {messages.length === 0 && (
          <View style={styles.emptyState}>
            <View style={styles.emptyStateIcon}>
              <Ionicons name="chatbubbles" size={48} color="#8e8e8e" />
            </View>
            <Text style={styles.emptyStateText}>
              Starting voice conversation...
            </Text>
          </View>
        )}
        {messages.map(renderMessage)}
        {isLoading && (
          <View style={[styles.messageContainer, styles.botMessage]}>
            <View style={[styles.messageBubble, styles.botBubble, { backgroundColor: '#fff' }]}>
              <View style={styles.typingContainer}>
                <Text style={[styles.messageText, { color: '#8e8e8e', marginRight: 8 }]}>
                  Processing...
                </Text>
                <ActivityIndicator size="small" color="#8e8e8e" />
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Voice Controls */}
      <View style={[styles.voiceControls, { paddingBottom: inputBottomPadding }]}>
        <View style={styles.conversationStatus}>
          <View style={[
            styles.statusIndicator,
            !isAudioInitialized && styles.initializingIndicator,
            isListening && styles.listeningIndicator,
            isProcessing && styles.processingIndicator,
            isSpeaking && styles.speakingIndicator,
          ]} />
          <Text style={styles.statusText}>
            {!isAudioInitialized ? "🔧 Initializing audio..." :
             isListening ? `🎤 Listening... ${countdown > 0 ? `(${countdown/10}s)` : 'Speak naturally'}` : 
             isProcessing ? "🤖 Processing your message..." : 
             isSpeaking ? "🔊 Speaking..." : 
             conversationActive ? "💬 Ready to chat" : "⏸️ Conversation paused"}
          </Text>
        </View>
        
        <View style={styles.conversationButtons}>
          {!conversationActive ? (
            <TouchableOpacity
              style={styles.startConversationButton}
              onPress={startConversation}
              disabled={!isAudioInitialized}
            >
              <Ionicons name="mic" size={24} color="#fff" />
              <Text style={styles.startConversationText}>Start Talking</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.stopConversationButton}
              onPress={stopConversation}
            >
              <Ionicons name="close" size={24} color="#fff" />
              <Text style={styles.stopConversationText}>End Chat</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Error Display */}
        {recordingError && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{recordingError}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f8f8',
  },
  header: {
    backgroundColor: '#000000',
    paddingBottom: 8,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  profileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileImage: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  profileName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  profileStatus: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 1,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  messagesContainer: {
    flex: 1,
    backgroundColor: '#f8f8f8',
  },
  messagesContent: {
    padding: 16,
    paddingBottom: 20,
  },
  messageContainer: {
    marginBottom: 12,
  },
  userMessage: {
    alignItems: 'flex-end',
  },
  botMessage: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '80%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  userBubble: {
    backgroundColor: '#000000',
    borderBottomRightRadius: 4,
  },
  botBubble: {
    backgroundColor: '#fff',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#e1e1e1',
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
  },
  timestamp: {
    fontSize: 12,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  typingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyStateIcon: {
    marginBottom: 16,
  },
  emptyStateText: {
    fontSize: 16,
    color: '#8e8e8e',
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 20,
  },
  voiceControls: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#e1e1e1',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 10,
  },
  conversationStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#8e8e8e',
    marginRight: 8,
  },
  initializingIndicator: {
    backgroundColor: '#8e8e8e',
    animation: 'pulse',
  },
  listeningIndicator: {
    backgroundColor: '#ff4444',
    animation: 'pulse',
  },
  processingIndicator: {
    backgroundColor: '#ffa500',
    animation: 'pulse',
  },
  speakingIndicator: {
    backgroundColor: '#00aa00',
    animation: 'pulse',
  },
  statusText: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  conversationButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  startConversationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#000000',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  startConversationText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  stopConversationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ff4444',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  stopConversationText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  recordingControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  stopRecordingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffa500',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 25,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  stopRecordingText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  errorContainer: {
    backgroundColor: '#ffebee',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  errorText: {
    color: '#c62828',
    fontSize: 14,
    textAlign: 'center',
  },
});
