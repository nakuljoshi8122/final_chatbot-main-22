/**
 * Liquid Glass primitives.
 *
 * - <GlassScreen>  full-screen aurora gradient backdrop + floating glow blobs.
 * - <GlassPane>    frosted, blurred pane with hairline edge highlight.
 * - <GlassPill>    pill-shaped glass chip/button surface.
 *
 * Real blur runs on iOS and web. On Android, BlurView inside long scroll
 * lists is expensive and artifact-prone, so panes fall back to a more
 * opaque translucent fill that reads the same without the GPU cost.
 */
import React from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewProps, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';

import { Glass, GlassScheme } from '@/shared/theme/LiquidGlass';

const BLUR_SUPPORTED = Platform.OS === 'ios' || Platform.OS === 'web';

/* ------------------------------------------------------------------ */
/* GlassScreen                                                         */
/* ------------------------------------------------------------------ */

type GlassScreenProps = ViewProps & {
  scheme?: GlassScheme;
  /** Hide the decorative glow blobs (e.g. behind busy chat UIs). */
  plain?: boolean;
};

export function GlassScreen({
  scheme = 'light',
  plain = false,
  style,
  children,
  ...rest
}: GlassScreenProps) {
  const colors = Glass.aurora[scheme];
  return (
    <View style={[styles.fill, style]} {...rest}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} animated />
      <LinearGradient
        colors={[...colors]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {!plain && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <View
            style={[
              styles.blob,
              {
                top: -80,
                left: -60,
                backgroundColor:
                  scheme === 'dark' ? 'rgba(106,91,255,0.20)' : 'rgba(61,123,255,0.14)',
              },
            ]}
          />
          <View
            style={[
              styles.blob,
              {
                bottom: -100,
                right: -70,
                backgroundColor:
                  scheme === 'dark' ? 'rgba(43,184,168,0.14)' : 'rgba(240,97,158,0.10)',
              },
            ]}
          />
        </View>
      )}
      {children}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* GlassPane                                                           */
/* ------------------------------------------------------------------ */

type GlassPaneProps = ViewProps & {
  scheme?: GlassScheme;
  /** Frost strength: soft (barely there), regular, strong (opaque-ish). */
  intensity?: 'soft' | 'regular' | 'strong';
  radius?: number;
  /** Disable the real blur layer (cheaper; used inside long lists). */
  noBlur?: boolean;
  /** Disable the drop shadow. */
  flat?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
};

export function GlassPane({
  scheme = 'light',
  intensity = 'regular',
  radius = Glass.radius.lg,
  noBlur = false,
  flat = false,
  style,
  contentStyle,
  children,
  ...rest
}: GlassPaneProps) {
  const dark = scheme === 'dark';
  const useBlur = BLUR_SUPPORTED && !noBlur;

  const fill = dark
    ? intensity === 'strong'
      ? Glass.fill.darkStrong
      : intensity === 'soft'
        ? Glass.fill.darkSoft
        : Glass.fill.dark
    : intensity === 'strong'
      ? Glass.fill.lightStrong
      : intensity === 'soft'
        ? Glass.fill.lightSoft
        : Glass.fill.light;

  // Without real blur, bump opacity so content behind doesn't bleed through.
  const fallbackFill = dark
    ? intensity === 'soft'
      ? 'rgba(28,30,48,0.78)'
      : 'rgba(24,26,42,0.92)'
    : intensity === 'soft'
      ? 'rgba(255,255,255,0.78)'
      : 'rgba(255,255,255,0.92)';

  // Blur/fill/stroke sit in absoluteFill layers so `style` flexDirection /
  // alignItems / gap / padding actually lay out the children (the previous
  // inner wrapper swallowed those props and stacked everything as a column).
  return (
    <View
      style={[
        styles.paneOuter,
        {
          borderRadius: radius,
          borderColor: dark ? Glass.stroke.darkOuter : Glass.stroke.lightOuter,
          overflow: 'hidden',
        },
        !flat && (Glass.shadowSoft as ViewStyle),
        style,
      ]}
      {...rest}
    >
      {useBlur ? (
        <BlurView
          intensity={Glass.blur.regular}
          tint={dark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: useBlur ? fill : fallbackFill,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: dark ? Glass.stroke.dark : Glass.stroke.light,
            borderRadius: radius,
          },
        ]}
      />
      {contentStyle ? <View style={contentStyle}>{children}</View> : children}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* GlassPill                                                           */
/* ------------------------------------------------------------------ */

type GlassPillProps = ViewProps & {
  scheme?: GlassScheme;
  active?: boolean;
  /** Tint color used when active. Defaults to ink (monochrome). */
  activeColor?: string;
  style?: StyleProp<ViewStyle>;
};

export function GlassPill({
  scheme = 'light',
  active = false,
  activeColor,
  style,
  children,
  ...rest
}: GlassPillProps) {
  const dark = scheme === 'dark';
  const activeBg = activeColor ?? (dark ? 'rgba(244,246,255,0.92)' : 'rgba(16,20,37,0.90)');
  return (
    <View
      style={[
        styles.pill,
        dark ? styles.pillDark : styles.pillLight,
        active && { backgroundColor: activeBg, borderColor: 'transparent' },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  blob: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
  },
  paneOuter: {
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'transparent',
  },
  pill: {
    borderRadius: Glass.radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillLight: {
    backgroundColor: Glass.fill.light,
    borderColor: Glass.stroke.lightOuter,
  },
  pillDark: {
    backgroundColor: Glass.fill.dark,
    borderColor: Glass.stroke.dark,
  },
});
