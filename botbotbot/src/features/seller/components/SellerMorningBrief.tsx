import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { tapHaptic } from '@/shared/utils/sellerHaptics';
import { GlassPane } from '@/shared/ui/Glass';
import { Glass } from '@/shared/theme/LiquidGlass';
import { SellerTheme } from '@/shared/theme/SellerTheme';

export type MorningBriefStats = {
  lowStock: number;
  drafts: number;
  queries: number;
  movers?: { name: string; count: number }[];
};

type Priority = {
  sku: string;
  name: string;
  reason: string;
};

type Props = {
  storeName: string;
  stats: MorningBriefStats;
  done?: { lowStock?: boolean; drafts?: boolean; queries?: boolean };
  narrative?: string;
  priorities?: Priority[];
  /** When true, hide inline AI box (shown in FAB instead). */
  hideAiInline?: boolean;
  onLowStock: () => void;
  onDrafts: () => void;
  onQueries: () => void;
  onDoneToday: () => void;
};

/** Quiet status lines for an empty chat — same type size as starter tiles. */
export default function SellerMorningBrief({
  stats,
  done,
  narrative,
  priorities,
  hideAiInline = false,
  onLowStock,
  onDrafts,
  onQueries,
  onDoneToday,
}: Props) {
  const bullets = [
    {
      key: 'low',
      text:
        stats.lowStock === 0
          ? 'No low stock'
          : `${stats.lowStock} low stock`,
      muted: stats.lowStock === 0 || !!done?.lowStock,
      onPress: onLowStock,
    },
    {
      key: 'drafts',
      text:
        stats.drafts === 0
          ? 'No drafts waiting'
          : `${stats.drafts} draft${stats.drafts === 1 ? '' : 's'}`,
      muted: stats.drafts === 0 || !!done?.drafts,
      onPress: onDrafts,
    },
    {
      key: 'queries',
      text:
        stats.queries === 0
          ? 'No open questions'
          : `${stats.queries} question${stats.queries === 1 ? '' : 's'}`,
      muted: stats.queries === 0 || !!done?.queries,
      onPress: onQueries,
    },
  ];

  const allClear =
    (stats.lowStock === 0 || done?.lowStock) &&
    (stats.drafts === 0 || done?.drafts) &&
    (stats.queries === 0 || done?.queries);

  return (
    <GlassPane
      scheme="light"
      intensity="regular"
      radius={Glass.radius.lg}
      noBlur
      flat
      style={styles.wrap}
      contentStyle={styles.wrapContent}
    >
      {!hideAiInline && narrative ? (
        <View style={styles.aiBox}>
          <Text style={styles.aiLabel}>AI brief</Text>
          <Text style={styles.aiText}>{narrative}</Text>
          {priorities?.[0] ? (
            <Text style={styles.aiPriority}>
              Priority: {priorities[0].name} — {priorities[0].reason}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={styles.bullets}>
        {bullets.map((b) => (
          <TouchableOpacity
            key={b.key}
            style={styles.line}
            onPress={() => {
              tapHaptic();
              b.onPress();
            }}
            activeOpacity={0.65}
            hitSlop={6}
          >
            <Text style={[styles.bullet, b.muted && styles.muted]}>·</Text>
            <Text style={[styles.text, b.muted && styles.muted]}>{b.text}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {!allClear ? (
        <TouchableOpacity
          onPress={() => {
            tapHaptic();
            onDoneToday();
          }}
          hitSlop={8}
          style={styles.doneHit}
        >
          <Text style={styles.done}>Done for today</Text>
        </TouchableOpacity>
      ) : null}
    </GlassPane>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 12,
  },
  wrapContent: {
    paddingTop: 20,
    paddingBottom: 16,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  aiBox: {
    backgroundColor: 'rgba(24,30,54,0.06)',
    borderRadius: Glass.radius.md,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Glass.stroke.lightOuter,
  },
  aiLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: Glass.tint.blue,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  aiText: {
    fontSize: 13.5,
    lineHeight: 19,
    color: SellerTheme.text,
    fontWeight: '500',
  },
  aiPriority: {
    marginTop: 8,
    fontSize: 12,
    color: Glass.tint.green,
    fontWeight: '700',
  },
  bullets: {
    gap: 12,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 22,
  },
  bullet: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
    color: SellerTheme.textSecondary,
    width: 10,
  },
  text: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
    color: SellerTheme.text,
    fontWeight: '500',
  },
  muted: {
    color: SellerTheme.textSecondary,
  },
  doneHit: {
    marginTop: 14,
    alignSelf: 'flex-start',
  },
  done: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: Glass.tint.blue,
  },
});
