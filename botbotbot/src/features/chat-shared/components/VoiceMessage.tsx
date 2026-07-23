import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVoicePlayback } from '@/shared/hooks/useVoicePlayback';
import { Glass } from '@/shared/theme/LiquidGlass';

interface VoiceMessageProps {
  isUser: boolean;
  audioUri: string;
  transcribedText?: string;
  timestamp: Date;
  onTranscribedTextPress?: () => void;
}

export default function VoiceMessage({
  isUser,
  audioUri,
  transcribedText,
  timestamp,
  onTranscribedTextPress,
}: VoiceMessageProps) {
  const [showTranscription, setShowTranscription] = useState(false);
  const { isPlaying, isPaused, duration, position, playAudio, pauseAudio, resumeAudio, stopAudio } = useVoicePlayback();
  const [waveformAnimation] = useState(new Animated.Value(0));

  const handlePlayPause = async () => {
    if (isPlaying && !isPaused) {
      await pauseAudio();
    } else if (isPlaying && isPaused) {
      await resumeAudio();
    } else {
      await playAudio(audioUri);
      startWaveformAnimation();
    }
  };

  const startWaveformAnimation = () => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(waveformAnimation, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(waveformAnimation, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
  };

  const formatTime = (milliseconds: number) => {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const progress = duration > 0 ? (position / duration) * 100 : 0;

  return (
    <View style={[styles.container, isUser ? styles.userContainer : styles.botContainer]}>
      <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.botBubble]}>
        {/* Voice Controls */}
        <View style={styles.voiceControls}>
          <TouchableOpacity
            style={[styles.playButton, isUser ? styles.userPlayButton : styles.botPlayButton]}
            onPress={handlePlayPause}
          >
            <Ionicons
              name={isPlaying && !isPaused ? 'pause' : 'play'}
              size={20}
              color={isUser ? '#fff' : Glass.ink.light}
            />
          </TouchableOpacity>

          {/* Waveform Visualization */}
          <View style={styles.waveformContainer}>
            <View style={styles.waveform}>
              {[...Array(20)].map((_, index) => {
                const height = isPlaying && !isPaused 
                  ? Math.random() * 20 + 5 
                  : 8;
                
                return (
                  <Animated.View
                    key={index}
                    style={[
                      styles.waveformBar,
                      {
                        height,
                        backgroundColor: isUser ? 'rgba(255,255,255,0.76)' : Glass.tint.blue,
                        opacity: index < (progress / 5) ? 1 : 0.3,
                      },
                    ]}
                  />
                );
              })}
            </View>
            
            {/* Progress Bar */}
            <View style={styles.progressContainer}>
              <View style={[styles.progressBar, { width: `${progress}%` }]} />
            </View>
          </View>

          {/* Duration */}
          <Text style={[styles.duration, { color: isUser ? 'rgba(255,255,255,0.8)' : Glass.ink.lightSecondary }]}>
            {formatTime(duration)}
          </Text>

        </View>

        {/* Transcription Toggle */}
        {transcribedText && (
          <TouchableOpacity
            style={styles.transcriptionToggle}
            onPress={() => setShowTranscription(!showTranscription)}
          >
            <Ionicons
              name={showTranscription ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={isUser ? 'rgba(255,255,255,0.7)' : Glass.ink.lightSecondary}
            />
            <Text style={[styles.transcriptionToggleText, { color: isUser ? 'rgba(255,255,255,0.7)' : Glass.ink.lightSecondary }]}>
              {showTranscription ? 'Hide' : 'Show'} transcription
            </Text>
          </TouchableOpacity>
        )}

        {/* Transcription Text */}
        {showTranscription && transcribedText && (
          <View style={styles.transcriptionContainer}>
            <Text style={[styles.transcriptionText, { color: isUser ? 'rgba(255,255,255,0.9)' : Glass.ink.light }]}>
              {transcribedText}
            </Text>
          </View>
        )}

        {/* Timestamp */}
        <Text style={[styles.timestamp, { color: isUser ? 'rgba(255,255,255,0.7)' : Glass.ink.lightSecondary }]}>
          {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  userContainer: {
    alignItems: 'flex-end',
  },
  botContainer: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '80%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: Glass.radius.md,
    ...Glass.shadowSoft,
  },
  userBubble: {
    backgroundColor: 'rgba(61,123,255,0.92)',
    borderBottomRightRadius: 4,
  },
  botBubble: {
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: Glass.stroke.lightOuter,
  },
  voiceControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  userPlayButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  botPlayButton: {
    backgroundColor: 'rgba(61,123,255,0.14)',
  },
  waveformContainer: {
    flex: 1,
    marginRight: 12,
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 20,
    marginBottom: 4,
  },
  waveformBar: {
    width: 2,
    marginHorizontal: 1,
    borderRadius: 1,
  },
  progressContainer: {
    height: 2,
    backgroundColor: 'rgba(24,30,54,0.12)',
    borderRadius: 1,
  },
  progressBar: {
    height: '100%',
    backgroundColor: Glass.tint.blue,
    borderRadius: 1,
  },
  duration: {
    fontSize: 12,
    fontWeight: '500',
  },
  transcriptionToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  transcriptionToggleText: {
    fontSize: 12,
    marginLeft: 4,
  },
  transcriptionContainer: {
    marginBottom: 8,
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: Glass.radius.xs,
  },
  transcriptionText: {
    fontSize: 14,
    lineHeight: 20,
  },
  timestamp: {
    fontSize: 12,
    alignSelf: 'flex-end',
  },
});
