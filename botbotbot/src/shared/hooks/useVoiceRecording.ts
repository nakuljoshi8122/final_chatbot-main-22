import { useState, useRef, useEffect } from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';

export interface VoiceRecordingState {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  recordingUri: string | null;
  error: string | null;
  isInitialized: boolean;
}

export interface VoiceRecordingControls {
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string | null>;
  pauseRecording: () => Promise<void>;
  resumeRecording: () => Promise<void>;
  resetRecording: () => void;
}

export function useVoiceRecording(): VoiceRecordingState & VoiceRecordingControls {
  const [error, setError] = useState<string | null>(null);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  
  // Use expo-av for recording
  const recordingRef = useRef<Audio.Recording | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startDurationTimer = () => {
    durationIntervalRef.current = setInterval(() => {
      setDuration(prev => prev + 0.1);
    }, 100);
  };

  const stopDurationTimer = () => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  };

  // Initialize audio permissions and mode
  useEffect(() => {
    const initializeAudio = async () => {
      try {
        console.log('Initializing audio...');
        
        const status = await Audio.requestPermissionsAsync();
        console.log('Permission status:', status);
        
        if (status.status !== 'granted') {
          setError('Microphone permission not granted');
          return;
        }

        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
          staysActiveInBackground: false,
        });
        
        console.log('Audio initialized successfully');
        setIsInitialized(true);
      } catch (err) {
        console.error('Error initializing audio:', err);
        setError(err instanceof Error ? err.message : 'Failed to initialize audio');
      }
    };

    initializeAudio();
  }, []);

  const startRecording = async () => {
    try {
      console.log('Starting recording...');
      console.log('Is initialized:', isInitialized);
      
      setError(null);
      setDuration(0);
      setRecordingUri(null);
      setIsRecording(true);
      setIsPaused(false);
      
      if (!isInitialized) {
        throw new Error('Audio not initialized yet');
      }
      
      // Clean up any existing recording first
      if (recordingRef.current) {
        console.log('Cleaning up existing recording...');
        try {
          await recordingRef.current.stopAndUnloadAsync();
        } catch (cleanupErr) {
          console.log('Error during cleanup (this is usually fine):', cleanupErr);
        }
        recordingRef.current = null;
      }
      
      // Re-check permissions before recording
      console.log('Re-checking permissions...');
      const permissionStatus = await Audio.requestPermissionsAsync();
      console.log('Permission status:', permissionStatus);
      
      if (permissionStatus.status !== 'granted') {
        throw new Error('Microphone permission not granted');
      }
      
      // Ensure audio mode is set for recording
      console.log('Setting audio mode for recording...');
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
        staysActiveInBackground: false,
      });
      console.log('Audio mode set successfully');
      
      // Create a new recording
      console.log('Creating new recording...');
      const recording = new Audio.Recording();
      recordingRef.current = recording;
      
      // Prepare to record
      console.log('Preparing to record...');
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      console.log('Prepared to record');
      
      // Start recording
      console.log('Starting recording...');
      await recording.startAsync();
      console.log('Recording started');
      
      startDurationTimer();
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to start recording';
      console.error('Error starting recording:', err);
      setError(errorMessage);
      setIsRecording(false);
    }
  };

  const stopRecording = async (): Promise<string | null> => {
    try {
      console.log('Stopping recording...');
      console.log('Our isRecording state:', isRecording);
      
      stopDurationTimer();
      setIsRecording(false);
      
      // Make sure we're actually recording before trying to stop
      if (!isRecording || !recordingRef.current) {
        console.log('Not currently recording, nothing to stop');
        return null;
      }
      
      // Stop the recording
      console.log('Stopping recording...');
      await recordingRef.current.stopAndUnloadAsync();
      console.log('Recording stopped');
      
      // Get the URI
      const uri = recordingRef.current.getURI();
      console.log('Recording URI:', uri);
      
      if (uri) {
        // Verify the file exists and has content
        try {
          const fileInfo = await FileSystem.getInfoAsync(uri);
          console.log('File info:', fileInfo);
          
          if (fileInfo.exists && fileInfo.size && fileInfo.size > 0) {
            setRecordingUri(uri);
            console.log('✅ Recording saved successfully:', uri);
            recordingRef.current = null;
            return uri;
          } else {
            console.error('❌ File exists but is empty or invalid:', fileInfo);
            setError('Recording file is empty or does not exist');
            return null;
          }
        } catch (fileErr) {
          console.error('❌ Error checking file:', fileErr);
          setError('Failed to verify recording file');
          return null;
        }
      } else {
        console.error('❌ No audio file generated after stop');
        setError('No audio file generated');
        return null;
      }
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to stop recording';
      console.error('Error stopping recording:', err);
      setError(errorMessage);
      setIsRecording(false);
      return null;
    }
  };

  const pauseRecording = async () => {
    try {
      if (isRecording && recordingRef.current) {
        console.log('Pausing recording...');
        await recordingRef.current.pauseAsync();
        setIsPaused(true);
        stopDurationTimer();
      }
    } catch (err) {
      console.error('Error pausing recording:', err);
      setError(err instanceof Error ? err.message : 'Failed to pause recording');
    }
  };

  const resumeRecording = async () => {
    try {
      if (isRecording && isPaused && recordingRef.current) {
        console.log('Resuming recording...');
        await recordingRef.current.startAsync();
        setIsPaused(false);
        startDurationTimer();
      }
    } catch (err) {
      console.error('Error resuming recording:', err);
      setError(err instanceof Error ? err.message : 'Failed to resume recording');
    }
  };

  const resetRecording = async () => {
    console.log('Resetting recording...');
    
    // Clean up any existing recording
    if (recordingRef.current) {
      try {
        await recordingRef.current.stopAndUnloadAsync();
        console.log('Cleaned up existing recording during reset');
      } catch (cleanupErr) {
        console.log('Error during reset cleanup (this is usually fine):', cleanupErr);
      }
      recordingRef.current = null;
    }
    
    setDuration(0);
    setRecordingUri(null);
    setError(null);
    setIsRecording(false);
    setIsPaused(false);
    stopDurationTimer();
  };

  return {
    isRecording: isRecording,
    isPaused: isPaused,
    duration,
    recordingUri,
    error,
    isInitialized,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    resetRecording,
  };
}