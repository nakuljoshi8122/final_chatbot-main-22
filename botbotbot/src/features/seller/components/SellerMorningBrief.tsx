import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { tapHaptic } from '@/shared/utils/sellerHaptics';

export type MorningBriefStats = {
  lowStock: number;
  drafts: number;
  queries: number;
  movers?: { name: string; count: number }[];
};

type Props = {
  storeName: string;
  stats: MorningBriefStats;
  done?: { lowStock?: boolean; drafts?: boolean; queries?: boolean };
  onLowStock: () => void;
  onDrafts: () => void;
  onQueries: () => void;
  onDoneToday: () => void;
};

/** Quiet status lines for an empty chat — same type size as starter tiles. */
export default function SellerMorningBrief({
  stats,
  done,
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
    <View style={styles.wrap}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: 20,
    paddingBottom: 16,
    paddingHorizontal: 2,
    justifyContent: 'center',
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
    color: '#9AA3AE',
    width: 10,
  },
  text: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
    color: '#8A929C',
    fontWeight: '500',
  },
  muted: {
    color: '#B4BAC2',
  },
  doneHit: {
    marginTop: 14,
    alignSelf: 'flex-start',
  },
  done: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: '#A0A8B0',
  },
});
