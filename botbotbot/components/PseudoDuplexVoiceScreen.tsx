import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, StyleSheet, Platform } from "react-native";
import * as Speech from "expo-speech";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiService } from "../services/api-fetch";
import { useVoicePlayback } from "../hooks/useVoicePlayback";

const VOICE_URL = `${process.env.EXPO_PUBLIC_API_URL || "http://192.168.0.155:8000"}/ask_voice`;

// Optimized recording options for better STT and smaller uploads
const REC_OPTS_16K_MONO: Audio.RecordingOptions = {
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 64000,
  },
  ios: {
    // Use WAV for best STT compatibility
    extension: '.wav',
    outputFormat: Audio.IOSOutputFormat.LINEARPCM,
    sampleRate: 16000,
    numberOfChannels: 1,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
    audioQuality: Audio.IOSAudioQuality.HIGH,
    bitRate: 64000,
  },
  web: undefined as any,
};

interface PseudoDuplexVoiceScreenProps {
  onClose: () => void;
}

export default function PseudoDuplexVoiceScreen({ onClose }: PseudoDuplexVoiceScreenProps) {
  const insets = useSafeAreaInsets();
  const topOffset = insets.top + 16;
  const recordingRef = useRef<Audio.Recording | null>(null);
  const vadTimer = useRef<any>(null);

  const [status, setStatus] = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [sessionId, setSessionId] = useState("");
  const [autoLoop, setAutoLoop] = useState(false); // keeps the hands-free loop running
  
  // Add a ref to track if component is mounted
  const isMountedRef = useRef(true);
  
  // Use the same voice playback hook as chat interface for proper speaker output
  const { playAudio, stopAudio } = useVoicePlayback();

  // ---- Session switches ----
  async function setRecordingMode() {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });
  }

  async function setPlaybackMode() {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    });
  }

  // ---- Recording options: mono @ 16k (ASR-friendly) ----
  const REC_OPTS_16K_MONO: Audio.RecordingOptions = {
    android: {
      extension: '.m4a',
      outputFormat: Audio.AndroidOutputFormat.MPEG_4,
      audioEncoder: Audio.AndroidAudioEncoder.AAC,
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 64000,
    },
    ios: {
      extension: '.wav',
      outputFormat: Audio.IOSOutputFormat.LINEARPCM,
      sampleRate: 16000,
      numberOfChannels: 1,
      linearPCMBitDepth: 16,
      linearPCMIsBigEndian: false,
      linearPCMIsFloat: false,
      audioQuality: Audio.IOSAudioQuality.HIGH,
      bitRate: 64000,
    },
    web: undefined as any,
  };

  // ---- Play base64 audio via file (better than data: URI) ----
  async function playBase64Audio(base64: string, ext: 'mp3'|'wav'='mp3') {
    console.log('🎵 [PSEUDO-DUPLEX] Starting base64 audio playback...');
    const path = `${FileSystem.cacheDirectory}agent-reply.${ext}`;
    await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
    const sound = new Audio.Sound();
    await sound.loadAsync({ uri: path }, { shouldPlay: true });
    console.log('🎵 [PSEUDO-DUPLEX] Audio loaded and playing...');
    return new Promise<void>((resolve) => {
      sound.setOnPlaybackStatusUpdate((s: any) => {
        if (!s?.isLoaded) return;
        if (s.didJustFinish || (!s.isPlaying && s.positionMillis > 0)) {
          console.log('🎵 [PSEUDO-DUPLEX] Audio playback finished, resolving...');
          sound.unloadAsync();
          resolve();
        }
      });
    });
  }

  // Smart VAD constants - More responsive settings
  const POLL_MS = 80;
  const CALIBRATE_MS = 1000; // Longer calibration for better noise floor
  const EMA_ALPHA = 0.3; // More responsive to changes
  const ENTER_OFFSET_DB = 12; // Lower threshold to detect speech easier
  const EXIT_OFFSET_DB = 8; // Higher threshold to avoid cutting off speech
  const SILENCE_HANG_MS = 2500; // Longer silence before stopping (2.5s)
  const MIN_SPEECH_MS = 300; // Shorter minimum speech duration
  const MAX_UTTER_MS = 15000; // Longer max utterance time

  function median(a: number[]) {
    const b = [...a].sort((x,y)=>x-y);
    const m = Math.floor(b.length/2);
    return b.length % 2 ? b[m] : (b[m-1]+b[m])/2;
  }

  async function startListeningWithSmartVAD(forceAutoLoop = false) {
    const shouldStart = forceAutoLoop || autoLoop;
    console.log('🎤 [PSEUDO-DUPLEX] startListeningWithSmartVAD called', { 
      autoLoop, 
      forceAutoLoop,
      shouldStart,
      isMounted: isMountedRef.current,
      status,
      platform: Platform.OS
    });
    
    if (!shouldStart || !isMountedRef.current) {
      console.log('❌ [PSEUDO-DUPLEX] Not starting - shouldStart:', shouldStart, 'isMounted:', isMountedRef.current);
      return; // don't start if user toggled it off or component unmounted
    }

    // Store the forceAutoLoop value for the VAD loop to use
    const vadAutoLoop = forceAutoLoop || autoLoop;

    console.log('🎤 [PSEUDO-DUPLEX] Stopping any current speech/audio...');
    // stop any speaking (barge-in), switch to recording
    Speech.stop(); 
    stopAudio && stopAudio();
    
    console.log('🎤 [PSEUDO-DUPLEX] Setting recording mode...');
    await setRecordingMode();
    console.log('🎤 [PSEUDO-DUPLEX] Recording mode set successfully');

    // Android fallback: VAD metering isn't reliable in Expo Go — use tap/hold
    if (Platform.OS === 'android') {
      console.log('🤖 [PSEUDO-DUPLEX] Android detected - using fallback startListening...');
      await startListening(false); // your existing startListening (no VAD)
      console.log('🤖 [PSEUDO-DUPLEX] Android fallback completed');
      return;
    }

    console.log('🍎 [PSEUDO-DUPLEX] iOS detected - using metering-based VAD...');
    // iOS metering-based VAD
    const rec = new Audio.Recording();
    console.log('🍎 [PSEUDO-DUPLEX] Creating new recording...');
    await rec.prepareToRecordAsync(REC_OPTS_16K_MONO);
    console.log('🍎 [PSEUDO-DUPLEX] Recording prepared, starting...');
    await rec.startAsync();
    recordingRef.current = rec;
    setStatus("listening");
    console.log('🍎 [PSEUDO-DUPLEX] Recording started, status set to listening');

    // Calibrate noise floor
    console.log('🎤 [PSEUDO-DUPLEX] Starting noise calibration...');
    const calib: number[] = [];
    const t0 = Date.now();
    while (Date.now() - t0 < CALIBRATE_MS) {
      const s = await rec.getStatusAsync();
      // @ts-ignore iOS-only
      calib.push(typeof s.metering === "number" ? s.metering : -160);
      await new Promise(r => setTimeout(r, POLL_MS));
    }
    const noise = Math.min(-20, median(calib));
    const ENTER_DB = noise + ENTER_OFFSET_DB;
    const EXIT_DB = noise + EXIT_OFFSET_DB;
    console.log('🎤 [PSEUDO-DUPLEX] Calibration complete', { 
      noise, 
      ENTER_DB, 
      EXIT_DB, 
      samples: calib.length 
    });

    let ema = noise, speaking = false, speechMs = 0, silenceMs = 0;
    let lastEma = noise, emaChange = 0;
    const startAt = Date.now();

    // polling loop
    console.log('🎤 [PSEUDO-DUPLEX] Starting VAD polling loop...');
    vadTimer.current = setInterval(async () => {
      if (!recordingRef.current || !isMountedRef.current) { 
        console.log('🎤 [PSEUDO-DUPLEX] VAD stopping - no recording or unmounted');
        clearInterval(vadTimer.current); 
        vadTimer.current = null; 
        return; 
      }
      if (!vadAutoLoop) { 
        console.log('🎤 [PSEUDO-DUPLEX] VAD stopping - autoLoop disabled');
        clearInterval(vadTimer.current); 
        vadTimer.current = null; 
        return; 
      }

      // safety: hard timeout
      if (Date.now() - startAt >= MAX_UTTER_MS) {
        clearInterval(vadTimer.current); vadTimer.current = null;
        stopAndSend({ autoResume: vadAutoLoop });
        return;
      }

      const st = await rec.getStatusAsync();
      // @ts-ignore
      const db = typeof st.metering === "number" ? st.metering : -160;
      lastEma = ema;
      ema = EMA_ALPHA * db + (1 - EMA_ALPHA) * ema;
      emaChange = ema - lastEma;

        if (!speaking) {
          // Start speaking if we detect significant audio above threshold
          if (ema >= ENTER_DB || (ema > noise + 8 && emaChange > 2)) { 
            console.log('🎤 [PSEUDO-DUPLEX] Voice detected!', { ema, ENTER_DB, db, noise, emaChange });
            speaking = true; 
            speechMs = 0; 
            silenceMs = 0; 
          }
        } else {
          // Consider still speaking if audio is above exit threshold OR if there's recent activity
          const isStillSpeaking = ema >= EXIT_DB || (ema > noise + 5 && emaChange > 1);
          
          if (isStillSpeaking) { 
            speechMs += POLL_MS; 
            silenceMs = 0; 
            console.log('🎤 [PSEUDO-DUPLEX] Still speaking...', { ema, EXIT_DB, speechMs, emaChange });
          } else { 
            silenceMs += POLL_MS; 
            console.log('🎤 [PSEUDO-DUPLEX] Silence accumulating...', { ema, EXIT_DB, silenceMs, speechMs, emaChange });
          }

          // Only stop if we have enough speech AND enough silence
          if (silenceMs >= SILENCE_HANG_MS && speechMs >= MIN_SPEECH_MS) {
            console.log('🎤 [PSEUDO-DUPLEX] Silence detected, stopping recording', { 
              silenceMs, 
              speechMs, 
              SILENCE_HANG_MS, 
              MIN_SPEECH_MS,
              ema,
              noise,
              emaChange
            });
            clearInterval(vadTimer.current); 
            vadTimer.current = null; 
            stopAndSend({ autoResume: vadAutoLoop });
          }
        }
    }, POLL_MS);
  }


  // Unified speakReply function
  async function speakReply(
    replyText: string,
    audioB64?: string,
    opts?: { onDone?: () => void; autoResume?: boolean }
  ) {
    if (!isMountedRef.current) return; // Don't proceed if component is unmounted
    
    await setPlaybackMode();
    setStatus("speaking");

    // Prefer server TTS if provided
    if (audioB64) {
      try {
        // change 'mp3' to 'wav' if your backend returns wav
        await playBase64Audio(audioB64, 'mp3');
        console.log('🎤 [PSEUDO-DUPLEX] Server audio playback completed, calling onDone');
        opts?.onDone?.();
        return;
      } catch (e) {
        console.log("Server audio failed, falling back to device TTS", e);
      }
    }

    // Fallback to device TTS
    Speech.speak(replyText, {
      language: "en-US",
      rate: 0.9,
      pitch: 1.0,
      onDone: () => opts?.onDone?.(),
      onStopped: () => opts?.onDone?.(),
      onError: () => opts?.onDone?.(),
    });
  }

  useEffect(() => {
    console.log('🚀 [PSEUDO-DUPLEX] Component mounted');
    isMountedRef.current = true;
    
    return () => {
      console.log('🧹 [PSEUDO-DUPLEX] Component unmounting, cleaning up...');
      isMountedRef.current = false;
      setAutoLoop(false);
      
      // Clear VAD timer
      if (vadTimer.current) {
        console.log('🧹 [PSEUDO-DUPLEX] Clearing VAD timer');
        clearInterval(vadTimer.current);
        vadTimer.current = null;
      }
      
      // Stop speech and audio
      console.log('🧹 [PSEUDO-DUPLEX] Stopping speech and audio');
      Speech.stop();
      stopAudio();
      
      // Clean up recording
      if (recordingRef.current) {
        console.log('🧹 [PSEUDO-DUPLEX] Stopping recording');
        recordingRef.current.stopAndUnloadAsync().catch((error) => {
          console.log('⚠️ [PSEUDO-DUPLEX] Error during cleanup (this is okay):', error.message);
        });
        recordingRef.current = null;
      }
    };
  }, []); // Empty dependency array to prevent re-mounting

  async function startListening(useVAD = false) {
    console.log('🎤 [PSEUDO-DUPLEX] startListening called', { 
      useVAD, 
      currentStatus: status, 
      autoLoop, 
      isMounted: isMountedRef.current,
      platform: Platform.OS
    });
    
    // Prevent starting if already in a non-idle state (but allow if we're in listening state and no recording exists)
    if (status !== "idle" && status !== "listening") {
      console.log('⚠️ [PSEUDO-DUPLEX] Cannot start listening, current status:', status);
      return;
    }
    
    // If we're already listening but have no recording, something went wrong, so reset
    if (status === "listening" && !recordingRef.current) {
      console.log('⚠️ [PSEUDO-DUPLEX] Status is listening but no recording exists, resetting...');
      setStatus("idle");
    }
    
    // ALWAYS clean up any existing recording first
    if (recordingRef.current) {
      console.log('🧹 [PSEUDO-DUPLEX] Cleaning up existing recording before starting new one');
      try {
        await recordingRef.current.stopAndUnloadAsync();
      } catch (error) {
        console.log('⚠️ [PSEUDO-DUPLEX] Error stopping existing recording (this is okay):', (error as Error).message);
      }
      recordingRef.current = null;
    }
    
    // Also clear any existing VAD timer
    if (vadTimer.current) {
      console.log('🧹 [PSEUDO-DUPLEX] Clearing existing VAD timer');
      clearInterval(vadTimer.current);
      vadTimer.current = null;
    }
    
    // Small delay to ensure cleanup is complete
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // BARGE-in: stop any ongoing TTS and audio immediately
    console.log('🔊 [PSEUDO-DUPLEX] Stopping any ongoing TTS and audio for barge-in');
    Speech.stop();
    stopAudio(); // Stop any previous Audio.Sound playback
    setStatus("listening");

    try {
      console.log('🎤 [PSEUDO-DUPLEX] Requesting audio permissions...');
      const permissionResult = await Audio.requestPermissionsAsync();
      console.log('🎤 [PSEUDO-DUPLEX] Permission result:', permissionResult);
      
      if (!permissionResult.granted) {
        console.error('❌ [PSEUDO-DUPLEX] Audio permission not granted');
        setStatus("idle");
        return;
      }
      
      console.log('🎤 [PSEUDO-DUPLEX] Setting recording mode...');
      await setRecordingMode();
      console.log('🎤 [PSEUDO-DUPLEX] Recording mode set successfully');

      console.log('🎤 [PSEUDO-DUPLEX] Creating new recording...');
      
      // Double-check that we don't have an existing recording
      if (recordingRef.current) {
        console.log('⚠️ [PSEUDO-DUPLEX] Recording still exists, cleaning up again');
        try {
          await (recordingRef.current as Audio.Recording).stopAndUnloadAsync();
        } catch (error) {
          console.log('⚠️ [PSEUDO-DUPLEX] Error in double cleanup:', (error as Error).message);
        }
        recordingRef.current = null;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      const rec = new Audio.Recording();
      
      // Use optimized 16kHz mono for better STT and smaller uploads
      console.log('🎤 [PSEUDO-DUPLEX] Preparing recording with 16kHz mono...');
      try {
        await rec.prepareToRecordAsync(REC_OPTS_16K_MONO);
        console.log('🎤 [PSEUDO-DUPLEX] Recording prepared successfully with 16kHz mono');
      } catch (customError) {
        console.log('⚠️ [PSEUDO-DUPLEX] Custom options failed, trying HIGH_QUALITY:', (customError as Error).message);
        try {
          await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
          console.log('🎤 [PSEUDO-DUPLEX] Recording prepared successfully with HIGH_QUALITY');
        } catch (highQualityError) {
          console.log('⚠️ [PSEUDO-DUPLEX] HIGH_QUALITY failed, trying LOW_QUALITY:', (highQualityError as Error).message);
          await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.LOW_QUALITY);
          console.log('🎤 [PSEUDO-DUPLEX] Recording prepared successfully with LOW_QUALITY');
        }
      }
      
      console.log('🎤 [PSEUDO-DUPLEX] Starting recording...');
      
      // Add a timeout to catch if recording start hangs - MORE RELIABLE
      const recordingPromise = rec.startAsync();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Recording start timeout')), 5000)
      );
      
      await Promise.race([recordingPromise, timeoutPromise]);
      console.log('🎤 [PSEUDO-DUPLEX] Recording started successfully');
      
      recordingRef.current = rec;
      console.log('🎤 [PSEUDO-DUPLEX] Recording reference set');
      
      // Verify recording is actually working
      try {
        const status = await rec.getStatusAsync();
        console.log('🎤 [PSEUDO-DUPLEX] Recording status:', status);
        if (!status.isRecording) {
          throw new Error('Recording status shows not recording');
        }
      } catch (statusError) {
        console.error('❌ [PSEUDO-DUPLEX] Recording status check failed:', statusError);
        throw statusError;
      }
      
    } catch (error) {
      console.error('❌ [PSEUDO-DUPLEX] Error in recording setup:', error);
      console.error('❌ [PSEUDO-DUPLEX] Error details:', (error as Error).message);
      console.error('❌ [PSEUDO-DUPLEX] Error stack:', (error as Error).stack);
      setStatus("idle");
      return;
    }

    // Simple hold-to-talk mode - no VAD needed
    // Add a safety timeout to prevent infinite recording
    setTimeout(() => {
      if (status === "listening") {
        console.log('⏰ [PSEUDO-DUPLEX] Safety timeout reached, stopping recording...');
        stopAndSend();
      }
    }, 10000); // 10 second safety timeout
  }

  async function stopAndSend(opts?: { autoResume?: boolean }) {
    const { autoResume = false } = opts || {};
    console.log('🛑 [PSEUDO-DUPLEX] stopAndSend called', { 
      autoResume, 
      isMounted: isMountedRef.current,
      hasRecording: !!recordingRef.current,
      currentStatus: status 
    });
    
    if (!isMountedRef.current) {
      console.log('❌ [PSEUDO-DUPLEX] Component unmounted, not proceeding');
      return; // Don't proceed if component is unmounted
    }
    
    console.log('🛑 [PSEUDO-DUPLEX] Proceeding with stop and send...');
    
    const rec = recordingRef.current;
    if (!rec) {
      console.log('❌ [PSEUDO-DUPLEX] No recording to stop - recording may not have started properly');
      setStatus("idle");
      if (autoResume) startListeningWithSmartVAD();
      return;
    }

    // Check minimum recording duration (prevent accidental sends)
    try {
      const status = await rec.getStatusAsync();
      console.log('🛑 [PSEUDO-DUPLEX] Recording duration:', status.durationMillis, 'ms');
      
      // Minimum 500ms recording duration - MORE STABLE
      if (status.durationMillis < 500) {
        console.log('⚠️ [PSEUDO-DUPLEX] Recording too short, ignoring send request');
        await rec.stopAndUnloadAsync();
        recordingRef.current = null;
        if (vadTimer.current) { 
          clearInterval(vadTimer.current); 
          vadTimer.current = null; 
        }
        setStatus("idle");
        if (autoResume) startListeningWithSmartVAD();
        return;
      }
    } catch (error) {
      console.log('⚠️ [PSEUDO-DUPLEX] Could not check duration, proceeding anyway:', error);
    }

    try {
      console.log('🛑 [PSEUDO-DUPLEX] Stopping and unloading recording...');
      await rec.stopAndUnloadAsync();
    } catch (error) {
      console.error('❌ [PSEUDO-DUPLEX] Error stopping recording:', error);
    }
    recordingRef.current = null;
    if (vadTimer.current) { 
      console.log('🛑 [PSEUDO-DUPLEX] Clearing VAD timer');
      clearInterval(vadTimer.current); 
      vadTimer.current = null; 
    }

    setStatus("thinking");
    console.log('🤔 [PSEUDO-DUPLEX] Status: thinking');

    const uri = rec.getURI();
    console.log('📁 [PSEUDO-DUPLEX] Recording URI:', uri);
    if (!uri) { 
      console.log('❌ [PSEUDO-DUPLEX] No recording URI, returning to idle');
      setStatus("idle"); 
      if (autoResume) startListeningWithSmartVAD();
      return; 
    }

    // Upload audio → Voice endpoint (STT + Agent + TTS in one call)
    console.log('📤 [PSEUDO-DUPLEX] Preparing audio file for upload...');
    console.log('📤 [PSEUDO-DUPLEX] Audio URI:', uri);
    
    // Verify the audio file exists (same as working implementation)
    const fileInfo = await FileSystem.getInfoAsync(uri);
    console.log('📤 [PSEUDO-DUPLEX] File info:', fileInfo);
    
    if (!fileInfo.exists) {
      console.error('❌ [PSEUDO-DUPLEX] Audio file does not exist');
      setStatus("idle");
      return;
    }
    
    if (!fileInfo.size || fileInfo.size === 0) {
      console.error('❌ [PSEUDO-DUPLEX] Audio file is empty');
      setStatus("idle");
      return;
    }
    
    // Create FormData exactly like the working implementation
    const formData = new FormData();
    
    // Add the audio file with proper file extension (same as working code)
    const fileExtension = uri.includes('.m4a') ? '.m4a' : '.wav';
    formData.append('audio_file', {
      uri: uri,
      type: `audio/${fileExtension.substring(1)}`,
      name: `recording${fileExtension}`,
    } as any);
    
    // Use existing session or create new one
    const currentSessionId = sessionId || `pseudo_duplex_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    if (!sessionId) {
      setSessionId(currentSessionId);
      console.log('🆔 [PSEUDO-DUPLEX] Created new session:', currentSessionId);
    } else {
      console.log('🆔 [PSEUDO-DUPLEX] Using existing session:', currentSessionId);
    }
    
    formData.append('session_id', currentSessionId);
    formData.append('return_audio', 'true'); // Request audio response for proper speaker output
    
    console.log('📤 [PSEUDO-DUPLEX] Sending to voice endpoint:', VOICE_URL);

    const response = await fetch(VOICE_URL, {
      method: 'POST',
      body: formData,
    }).then(r => r.json()).catch((error) => {
      console.error('❌ [PSEUDO-DUPLEX] Voice request failed:', error);
      return null;
    });
    console.log('📝 [PSEUDO-DUPLEX] Voice response:', response);
    
    if (!response) {
      console.error('❌ [PSEUDO-DUPLEX] No response received');
      setStatus("idle");
      if (autoResume) startListeningWithSmartVAD();
      return;
    }
    
    // Update session ID from response to maintain conversation
    if (response.session_id && response.session_id !== sessionId) {
      console.log('🆔 [PSEUDO-DUPLEX] Updating session ID from response:', response.session_id);
      setSessionId(response.session_id);
    }
    
    const text = response?.transcribed_text?.trim() || "";
    const reply = response?.answer?.trim() || "I don't know based on our records.";
    const audioB64 = response?.audio_response; // base64 string from backend (mp3/wav)
    
    console.log('📝 [PSEUDO-DUPLEX] Transcribed text:', text);
    console.log('🤖 [PSEUDO-DUPLEX] Agent reply:', reply);
    
    // speak and auto-resume when done
    await speakReply(reply, audioB64, { 
      onDone: () => {
        console.log('🎤 [PSEUDO-DUPLEX] speakReply onDone called', { autoResume, isMounted: isMountedRef.current });
        setStatus("idle");
        if (autoResume) {
          console.log('🎤 [PSEUDO-DUPLEX] Auto-resuming listening...');
          startListeningWithSmartVAD(true); // Pass true for auto-resume
        }
      },
      autoResume
    });
  }

  return (
    <View style={styles.container}>
      {/* Siri-like Header */}
      <View style={[styles.header, { top: topOffset }]}>
        <Text style={styles.title}>Voice Assistant</Text>
        <Text style={styles.subtitle}>
          {autoLoop
            ? (status === "listening" ? "Listening… (auto)"
              : status === "speaking" ? "Speaking… (auto)"
              : status === "thinking" ? "Thinking… (auto)"
              : "Ready (auto)")
            : (status === "listening" ? "Listening…"
              : status === "speaking" ? "Speaking…"
              : status === "thinking" ? "Thinking…"
              : "Tap to speak")}
        </Text>
      </View>

      {/* Main Voice Button - Siri Style */}
      <View style={styles.voiceContainer}>
        <Pressable 
          onPress={async () => {
            console.log('🎯 [PSEUDO-DUPLEX] Button pressed!', { 
              autoLoop, 
              status, 
              isMounted: isMountedRef.current,
              hasRecording: !!recordingRef.current,
              hasVadTimer: !!vadTimer.current
            });
            
            if (autoLoop) {
              console.log('🛑 [PSEUDO-DUPLEX] Stopping auto loop...');
              // stop the loop
              setAutoLoop(false);
              Speech.stop(); 
              stopAudio && stopAudio();
              if (vadTimer.current) { 
                console.log('🛑 [PSEUDO-DUPLEX] Clearing VAD timer');
                clearInterval(vadTimer.current); 
                vadTimer.current = null; 
              }
              if (recordingRef.current) {
                console.log('🛑 [PSEUDO-DUPLEX] Stopping recording');
                try { 
                  await recordingRef.current.stopAndUnloadAsync(); 
                } catch (e) {
                  console.log('⚠️ [PSEUDO-DUPLEX] Error stopping recording:', e);
                }
                recordingRef.current = null;
              }
              setStatus("idle");
              console.log('✅ [PSEUDO-DUPLEX] Auto loop stopped');
            } else {
              console.log('🚀 [PSEUDO-DUPLEX] Starting auto loop...');
              // start the loop
              setAutoLoop(true);
              console.log('🚀 [PSEUDO-DUPLEX] Auto loop state set to true, calling startListeningWithSmartVAD...');
              await startListeningWithSmartVAD(true); // Pass true directly
              console.log('🚀 [PSEUDO-DUPLEX] startListeningWithSmartVAD completed');
            }
          }} 
          style={({ pressed }) => [
            styles.voiceButton, 
            status === "listening" && styles.voiceButtonListening,
            status === "speaking" && styles.voiceButtonSpeaking,
            status === "thinking" && styles.voiceButtonThinking,
            autoLoop && styles.voiceButtonAuto,
            pressed && styles.voiceButtonPressed
          ]}
        >
          {/* Voice Button Content */}
          <View style={styles.voiceButtonContent}>
            {status === "thinking" ? (
              <ActivityIndicator size="large" color="#007AFF" />
            ) : status === "listening" ? (
              <View style={styles.recordingAnimation}>
                <View style={[styles.recordingDot, styles.recordingDot1]} />
                <View style={[styles.recordingDot, styles.recordingDot2]} />
                <View style={[styles.recordingDot, styles.recordingDot3]} />
              </View>
            ) : status === "speaking" ? (
              <View style={styles.speakingAnimation}>
                <View style={[styles.speakingBar, styles.speakingBar1]} />
                <View style={[styles.speakingBar, styles.speakingBar2]} />
                <View style={[styles.speakingBar, styles.speakingBar3]} />
                <View style={[styles.speakingBar, styles.speakingBar4]} />
              </View>
            ) : (
              <View style={styles.micIcon}>
                <Text style={styles.micText}>🎤</Text>
              </View>
            )}
          </View>
        </Pressable>

        {/* Status Text */}
        <Text style={styles.statusText}>
          {status === "listening" ? "Listening..." :
           status === "speaking" ? "Speaking..." :
           status === "thinking" ? "Thinking..." : "Tap to speak"}
        </Text>
      </View>

      {/* Close Button */}
      <Pressable 
        onPress={() => {
          console.log('❌ [PSEUDO-DUPLEX] Close button pressed');
          onClose();
        }} 
        style={[styles.closeButton, { top: topOffset }]}
      >
        <Text style={styles.closeButtonText}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: "#000000", 
    justifyContent: "center", 
    alignItems: "center",
    paddingHorizontal: 20,
  },
  
  // Header
  header: {
    position: "absolute",
    alignItems: "center",
  },
  title: {
    color: "white",
    fontSize: 24,
    fontWeight: "600",
    marginBottom: 4,
  },
  subtitle: {
    color: "#8E8E93",
    fontSize: 16,
    fontWeight: "400",
  },

  // Voice Container
  voiceContainer: {
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },

  // Main Voice Button - Siri Style
  voiceButton: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "#1C1C1E",
    borderWidth: 2,
    borderColor: "#3A3A3C",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  voiceButtonListening: {
    backgroundColor: "#FF3B30",
    borderColor: "#FF6B6B",
    transform: [{ scale: 1.05 }],
  },
  voiceButtonSpeaking: {
    backgroundColor: "#007AFF",
    borderColor: "#4A9EFF",
    transform: [{ scale: 1.02 }],
  },
  voiceButtonThinking: {
    backgroundColor: "#FF9500",
    borderColor: "#FFB84D",
  },
  voiceButtonPressed: {
    transform: [{ scale: 0.95 }],
  },
  voiceButtonAuto: {
    borderColor: "#00FF00",
    borderWidth: 3,
    shadowColor: "#00FF00",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
  },

  // Voice Button Content
  voiceButtonContent: {
    justifyContent: "center",
    alignItems: "center",
  },

  // Microphone Icon
  micIcon: {
    justifyContent: "center",
    alignItems: "center",
  },
  micText: {
    fontSize: 48,
  },

  // Recording Animation (Pulsing Dots)
  recordingAnimation: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "white",
    marginHorizontal: 2,
  },
  recordingDot1: {
    opacity: 0.4,
  },
  recordingDot2: {
    opacity: 0.7,
  },
  recordingDot3: {
    opacity: 1,
  },

  // Speaking Animation (Sound Bars)
  speakingAnimation: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    height: 40,
  },
  speakingBar: {
    width: 4,
    backgroundColor: "white",
    marginHorizontal: 2,
    borderRadius: 2,
  },
  speakingBar1: {
    height: 12,
  },
  speakingBar2: {
    height: 20,
  },
  speakingBar3: {
    height: 28,
  },
  speakingBar4: {
    height: 16,
  },

  // Status Text
  statusText: {
    color: "white",
    fontSize: 18,
    fontWeight: "500",
    marginTop: 30,
    textAlign: "center",
  },

  // Close Button
  closeButton: {
    position: "absolute",
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    justifyContent: "center",
    alignItems: "center",
  },
  closeButtonText: {
    color: "white",
    fontSize: 20,
    fontWeight: "600",
  },
});































































