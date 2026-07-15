import { useState, useRef } from 'react';
import { Audio } from 'expo-av';

export interface VoicePlaybackState {
  isPlaying: boolean;
  isPaused: boolean;
  duration: number;
  position: number;
  error: string | null;
}

export interface VoicePlaybackControls {
  playAudio: (uri: string) => Promise<void>;
  pauseAudio: () => Promise<void>;
  resumeAudio: () => Promise<void>;
  stopAudio: () => Promise<void>;
  seekTo: (position: number) => Promise<void>;
}

export function useVoicePlayback(): VoicePlaybackState & VoicePlaybackControls {
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const soundRef = useRef<Audio.Sound | null>(null);

  const playAudio = async (uri: string) => {
    try {
      setError(null);
      console.log('🔊 playAudio called with URI:', uri);
      console.log('🔊 URI type:', typeof uri);
      console.log('🔊 URI length:', uri ? uri.length : 0);
      
      // Force audio mode for main speaker output
      console.log('Setting audio mode for main speaker...');
      // FORCE MAIN SPEAKER BY DEFAULT - Proper expo-av configuration
      console.log('🔊 FORCING MAIN SPEAKER BY DEFAULT...');
      
      // Set audio mode to force speaker output (not earpiece)
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false, // Disable recording to force playback mode
        playsInSilentModeIOS: true, // Play even if iPhone is on silent
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false, // CRITICAL: Force speaker on Android
      });
      console.log('🔊 Audio mode set to force speaker output');
      
      // Create and load the sound with FORCED SPEAKER OUTPUT
      console.log('🔊 Creating sound object...');
      console.log('🔊 Sound URI:', uri);
      
      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { 
          shouldPlay: true,
          volume: 1.0, // Maximum volume
          rate: 1.0,
          shouldCorrectPitch: true,
          isLooping: false,
          progressUpdateIntervalMillis: 100,
          androidImplementation: 'MediaPlayer', // Use MediaPlayer for better volume control
        },
        (status) => {
          console.log('🔊 Sound status update:', status);
          if (status.isLoaded) {
            setIsPlaying(status.isPlaying);
            setIsPaused(!status.isPlaying && status.positionMillis > 0);
            setDuration(status.durationMillis || 0);
            setPosition(status.positionMillis || 0);
            console.log('🔊 Sound loaded, playing:', status.isPlaying);
            console.log('🔊 Sound duration:', status.durationMillis);
            console.log('🔊 Sound position:', status.positionMillis);
          } else {
            console.log('🔊 Sound not loaded yet, status:', status);
          }
        }
      );
      console.log('🔊 Sound object created successfully');
      console.log('🔊 Sound object:', sound);
      
      soundRef.current = sound;
      
      // DEFAULT MAXIMUM VOLUME - Applied automatically
      console.log('🔊 APPLYING DEFAULT MAXIMUM VOLUME...');
      
      // Method 1: Set volume to maximum immediately
      await sound.setVolumeAsync(1.0);
      console.log('🔊 Default volume set to maximum (1.0)');
      
      // Method 2: FORCE MAIN SPEAKER OUTPUT - Multiple approaches
      console.log('🔊 FORCING MAIN SPEAKER OUTPUT...');
      
      // Approach 1: Standard speaker forcing
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false, // Set to false for playback
        playsInSilentModeIOS: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false, // Force main speaker
        staysActiveInBackground: false,
      });
      console.log('🔊 Standard speaker forcing applied');
      
      // Approach 2: Alternative audio mode for main speaker
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false, // Disable recording to force playback mode
        playsInSilentModeIOS: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false, // Force main speaker
        staysActiveInBackground: false,
      });
      console.log('🔊 Alternative audio mode applied');
      
      // Approach 3: Re-enable recording but force speaker
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false, // Force main speaker
        staysActiveInBackground: false,
      });
      console.log('🔊 Recording re-enabled with speaker forcing');
      
      // Method 3: Multiple volume enforcement attempts (automatic)
      const volumeBoostAttempts = [50, 100, 200, 500, 1000]; // Multiple timing attempts
      volumeBoostAttempts.forEach((delay, index) => {
        setTimeout(async () => {
          if (soundRef.current) {
            try {
              await soundRef.current.setVolumeAsync(1.0);
              console.log(`🔊 Auto volume boost (attempt ${index + 1}) at ${delay}ms`);
            } catch (err) {
              console.log(`Auto volume boost attempt ${index + 1} failed:`, err);
            }
          }
        }, delay);
      });
      
      // Method 4: Continuous volume enforcement during playback (automatic)
      const continuousVolumeBoost = setInterval(async () => {
        if (soundRef.current && isPlaying) {
          try {
            await soundRef.current.setVolumeAsync(1.0);
            console.log('🔊 Auto continuous volume boost applied');
          } catch (err) {
            clearInterval(continuousVolumeBoost);
          }
        }
      }, 2000); // Every 2 seconds
      
      // Clear interval after 30 seconds
      setTimeout(() => {
        clearInterval(continuousVolumeBoost);
        console.log('🔊 Auto continuous volume boost stopped');
      }, 30000);
      
      // Method 5: FORCE MAIN SPEAKER BY DEFAULT - Proper expo-av configuration
      console.log('🔊 FORCING MAIN SPEAKER BY DEFAULT...');
      
      // Re-apply proper audio mode to ensure speaker output
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false, // Disable recording to force playback mode
        playsInSilentModeIOS: true, // Play even if iPhone is on silent
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false, // CRITICAL: Force speaker on Android
      });
      console.log('🔊 Audio mode re-applied for speaker output');
      console.log('🔊 MAIN SPEAKER FORCED BY DEFAULT - Audio will play through main speaker automatically');
      console.log('🔊 playAudio function completed successfully');
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to play audio');
      console.error('❌ Error playing audio:', err);
      console.error('❌ Error details:', err instanceof Error ? err.message : 'Unknown error');
      console.error('❌ Error stack:', err instanceof Error ? err.stack : 'No stack trace');
    }
  };

  const pauseAudio = async () => {
    try {
      if (soundRef.current) {
        await soundRef.current.pauseAsync();
        setIsPlaying(false);
        setIsPaused(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause audio');
      console.error('Error pausing audio:', err);
    }
  };

  const resumeAudio = async () => {
    try {
      if (soundRef.current) {
        await soundRef.current.playAsync();
        setIsPlaying(true);
        setIsPaused(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume audio');
      console.error('Error resuming audio:', err);
    }
  };

  const stopAudio = async () => {
    try {
      if (soundRef.current) {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
        soundRef.current = null;
        setIsPlaying(false);
        setIsPaused(false);
        setPosition(0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop audio');
      console.error('Error stopping audio:', err);
    }
  };

  const seekTo = async (newPosition: number) => {
    try {
      if (soundRef.current && duration > 0) {
        const positionMillis = (newPosition / 100) * duration;
        await soundRef.current.setPositionAsync(positionMillis);
        setPosition(positionMillis);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to seek audio');
      console.error('Error seeking audio:', err);
    }
  };



  return {
    isPlaying,
    isPaused,
    duration,
    position,
    error,
    playAudio,
    pauseAudio,
    resumeAudio,
    stopAudio,
    seekTo,
  };
}