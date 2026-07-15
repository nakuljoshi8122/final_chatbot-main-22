import { useState, useEffect, useRef } from 'react';
import { useVoiceRecording } from './useVoiceRecording';
import { apiService } from '../services/api-fetch';

export interface VoiceRecognitionState {
  isListening: boolean;
  isProcessing: boolean;
  isInitialized: boolean;
  error: string | null;
  transcript: string | null;
}

export interface VoiceRecognitionActions {
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  reset: () => void;
}

export const useVoiceRecognition = (sessionId?: string): VoiceRecognitionState & VoiceRecognitionActions => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  
  const {
    isRecording: isListening,
    isInitialized,
    error: recordingError,
    startRecording,
    stopRecording,
    resetRecording,
  } = useVoiceRecording();

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (recordingError) {
      setError(recordingError);
    }
  }, [recordingError]);

  const startListening = async () => {
    try {
      console.log('🎤 Starting voice recognition...');
      setError(null);
      setTranscript(null);
      
      // Start recording with a short timeout for quick response
      await startRecording();
      
      // Set a timeout to automatically stop after 2 seconds
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      
      timeoutRef.current = setTimeout(async () => {
        if (isListening) {
          console.log('🎤 Auto-stopping recording after timeout');
          await stopListening();
        }
      }, 2000); // 2 seconds timeout
      
    } catch (err) {
      console.error('🎤 Error starting voice recognition:', err);
      setError('Failed to start voice recognition');
    }
  };

  const stopListening = async () => {
    try {
      console.log('🎤 Stopping voice recognition...');
      
      // Clear timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      
      // Stop recording and get the audio URI
      const audioUri = await stopRecording();
      
      if (audioUri) {
        console.log('🎤 Processing recorded audio...');
        await processAudio(audioUri);
      } else {
        console.log('🎤 No audio recorded');
      }
      
    } catch (err) {
      console.error('🎤 Error stopping voice recognition:', err);
      setError('Failed to stop voice recognition');
    }
  };

  const processAudio = async (audioUri: string) => {
    try {
      setIsProcessing(true);
      setError(null);
      
      console.log('🤖 Sending audio to backend for transcription...');
      
      // Send audio to backend for transcription and TTS
      const response = await apiService.sendVoiceMessage(audioUri, sessionId, true);
      
      console.log('🎤 Full response:', response);
      
      if (response.transcribed_text) {
        console.log('🎤 Transcription result:', response.transcribed_text);
        setTranscript(response.transcribed_text);
      } else {
        console.error('❌ No transcribed text in response:', response);
        setError('Failed to transcribe audio - no text returned');
      }
      
    } catch (err) {
      console.error('❌ Error processing audio:', err);
      setError('Failed to process audio');
    } finally {
      setIsProcessing(false);
    }
  };

  const reset = () => {
    console.log('🎤 Resetting voice recognition...');
    setTranscript(null);
    setError(null);
    setIsProcessing(false);
    
    // Clear timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    
    resetRecording();
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    isListening,
    isProcessing,
    isInitialized,
    error,
    transcript,
    startListening,
    stopListening,
    reset,
  };
};
