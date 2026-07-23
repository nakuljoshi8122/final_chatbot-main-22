import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  ScrollView,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tapHaptic } from '@/shared/utils/sellerHaptics';
import { usePeriodicBounce } from '@/shared/hooks/usePeriodicBounce';
import { loadBriefSeenSig, saveBriefSeenSig } from '@/services/sellerLazyStore';
import type { MorningBriefStats } from '@/features/seller/components/SellerMorningBrief';
import { GlassPane } from '@/shared/ui/Glass';
import { Glass } from '@/shared/theme/LiquidGlass';
import { SellerTheme } from '@/shared/theme/SellerTheme';

type Priority = {
  sku: string;
  name: string;
  reason: string;
};

type Props = {
  storeId: string;
  stats: MorningBriefStats;
  narrative?: string;
  priorities?: Priority[];
  done?: { lowStock?: boolean; drafts?: boolean; queries?: boolean };
  onLowStock: () => void;
  onDrafts: () => void;
  onQueries: () => void;
  onDoneToday: () => void;
  /** Hide when keyboard covers FAB area heavily — optional */
  bottomOffset?: number;
  /** header = calm chip in Assist top bar; fab = floating (legacy) */
  mode?: 'fab' | 'header';
};

function briefSignature(
  stats: MorningBriefStats,
  done?: { lowStock?: boolean; drafts?: boolean; queries?: boolean },
): string {
  const parts: string[] = [];
  if (stats.lowStock > 0 && !done?.lowStock) parts.push(`l${stats.lowStock}`);
  if (stats.drafts > 0 && !done?.drafts) parts.push(`d${stats.drafts}`);
  if (stats.queries > 0 && !done?.queries) parts.push(`q${stats.queries}`);
  return parts.join('|');
}

export default function SellerAiBriefFab({
  storeId,
  stats,
  narrative,
  priorities,
  done,
  onLowStock,
  onDrafts,
  onQueries,
  onDoneToday,
  bottomOffset = 0,
  mode = 'fab',
}: Props) {
  const [open, setOpen] = useState(false);
  const [seenSig, setSeenSig] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  const urgentCount =
    (stats.lowStock > 0 && !done?.lowStock ? 1 : 0) +
    (stats.drafts > 0 && !done?.drafts ? 1 : 0) +
    (stats.queries > 0 && !done?.queries ? 1 : 0);

  const sig = useMemo(() => briefSignature(stats, done), [stats, done]);
  const shouldBounce = mode === 'fab' && urgentCount > 0 && seenSig !== sig;
  const bounceY = usePeriodicBounce(shouldBounce);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadBriefSeenSig(storeId);
      if (!cancelled) setSeenSig(saved);
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  const markSeen = async () => {
    setSeenSig(sig);
    try {
      await saveBriefSeenSig(storeId, sig);
    } catch {
      // ignore persistence failures
    }
  };

  const bullets = [
    {
      key: 'low',
      text: stats.lowStock === 0 ? 'No low stock' : `${stats.lowStock} low stock`,
      muted: stats.lowStock === 0 || !!done?.lowStock,
      onPress: () => {
        setOpen(false);
        onLowStock();
      },
    },
    {
      key: 'drafts',
      text: stats.drafts === 0 ? 'No drafts waiting' : `${stats.drafts} draft${stats.drafts === 1 ? '' : 's'}`,
      muted: stats.drafts === 0 || !!done?.drafts,
      onPress: () => {
        setOpen(false);
        onDrafts();
      },
    },
    {
      key: 'queries',
      text:
        stats.queries === 0
          ? 'No open questions'
          : `${stats.queries} question${stats.queries === 1 ? '' : 's'}`,
      muted: stats.queries === 0 || !!done?.queries,
      onPress: () => {
        setOpen(false);
        onQueries();
      },
    },
  ];

  const allClear =
    (stats.lowStock === 0 || done?.lowStock) &&
    (stats.drafts === 0 || done?.drafts) &&
    (stats.queries === 0 || done?.queries);

  const fabBottom = Math.max(insets.bottom, 8) + bottomOffset + 148;

  const openBrief = () => {
    tapHaptic();
    void markSeen();
    setOpen(true);
  };

  return (
    <>
      {mode === 'header' ? (
        <TouchableOpacity
          style={styles.headerChip}
          onPress={openBrief}
          activeOpacity={0.8}
          accessibilityLabel="Open AI brief"
        >
          <Ionicons name="sparkles" size={14} color={Glass.tint.blue} />
          {urgentCount > 0 ? (
            <View style={styles.headerBadge}>
              <Text style={styles.badgeText}>{urgentCount}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      ) : (
        <Animated.View style={[styles.fabWrap, { bottom: fabBottom, transform: [{ translateY: bounceY }] }]}>
          <GlassPane
            scheme="light"
            intensity="regular"
            radius={Glass.radius.pill}
            style={styles.fab}
            contentStyle={styles.fabContent}
          >
            <TouchableOpacity
              style={styles.fabButton}
              onPress={openBrief}
              activeOpacity={0.85}
              accessibilityLabel="Open AI brief"
            >
              <Ionicons name="sparkles" size={22} color={Glass.tint.blue} />
            </TouchableOpacity>
          </GlassPane>
          {urgentCount > 0 ? (
            <View style={styles.badge} pointerEvents="none">
              <Text style={styles.badgeText}>{urgentCount}</Text>
            </View>
          ) : null}
        </Animated.View>
      )}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.dialogPress} onPress={(e) => e.stopPropagation()}>
            <GlassPane
              scheme="light"
              intensity="strong"
              radius={Glass.radius.lg}
              style={styles.dialog}
              contentStyle={styles.dialogContent}
            >
              <View style={styles.dialogHeader}>
              <View style={styles.dialogTitleRow}>
                <Ionicons name="sparkles" size={18} color={Glass.tint.blue} />
                <Text style={styles.dialogTitle}>AI Brief</Text>
              </View>
              <TouchableOpacity
                onPress={() => setOpen(false)}
                hitSlop={12}
                style={styles.closeBtn}
                accessibilityLabel="Close brief"
              >
                <Ionicons name="close" size={22} color={SellerTheme.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.dialogScroll}
              contentContainerStyle={styles.dialogBody}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {narrative ? (
                <View style={styles.aiBox}>
                  <Text style={styles.aiText}>{narrative}</Text>
                </View>
              ) : (
                <Text style={styles.aiTextMuted}>Your store status at a glance.</Text>
              )}

              {priorities && priorities.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Restock priorities</Text>
                  {priorities.slice(0, 4).map((p, i) => (
                    <Text key={p.sku || i} style={styles.priorityLine}>
                      {i + 1}. {p.name}
                      {p.reason ? ` — ${p.reason}` : ''}
                    </Text>
                  ))}
                </View>
              ) : null}

              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Today</Text>
                {bullets.map((b) => (
                  <TouchableOpacity
                    key={b.key}
                    style={styles.line}
                    onPress={() => {
                      tapHaptic();
                      b.onPress();
                    }}
                    activeOpacity={0.65}
                  >
                    <Text style={[styles.bullet, b.muted && styles.muted]}>·</Text>
                    <Text style={[styles.lineText, b.muted && styles.muted]}>{b.text}</Text>
                    {!b.muted ? (
                      <Ionicons name="chevron-forward" size={14} color={SellerTheme.textSecondary} />
                    ) : null}
                  </TouchableOpacity>
                ))}
              </View>

              {!allClear ? (
                <TouchableOpacity
                  style={styles.doneBtn}
                  onPress={() => {
                    tapHaptic();
                    onDoneToday();
                    setOpen(false);
                  }}
                >
                  <Text style={styles.doneBtnText}>Mark done for today</Text>
                </TouchableOpacity>
              ) : null}
              </ScrollView>
            </GlassPane>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  headerChip: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SellerTheme.chipIdle,
    position: 'relative',
  },
  headerBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: Glass.tint.red,
    borderRadius: 8,
    minWidth: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  fabWrap: {
    position: 'absolute',
    right: 16,
    zIndex: 20,
  },
  fab: {
    width: 52,
    height: 52,
    borderRadius: Glass.radius.pill,
    backgroundColor: 'rgba(61,123,255,0.18)',
    ...Glass.shadow,
  },
  fabContent: {
    width: 52,
    height: 52,
  },
  fabButton: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Glass.tint.red,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: SellerTheme.text,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  backdrop: {
    flex: 1,
    backgroundColor: SellerTheme.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialog: {
    width: '100%',
    maxHeight: '72%',
    borderRadius: Glass.radius.lg,
    ...Glass.shadow,
  },
  dialogPress: {
    width: '100%',
    maxWidth: 360,
  },
  dialogContent: {
    overflow: 'hidden',
  },
  dialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Glass.stroke.lightOuter,
  },
  dialogTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dialogTitle: { fontSize: 16, fontWeight: '800', color: SellerTheme.text },
  closeBtn: { padding: 4 },
  dialogScroll: { flexGrow: 0 },
  dialogBody: { padding: 16, gap: 14, paddingBottom: 20 },
  aiBox: {
    backgroundColor: 'rgba(24,30,54,0.06)',
    borderRadius: Glass.radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: Glass.stroke.lightOuter,
  },
  aiText: { fontSize: 14, lineHeight: 20, color: SellerTheme.text, fontWeight: '500' },
  aiTextMuted: { fontSize: 13, color: SellerTheme.textSecondary, fontStyle: 'italic' },
  section: { gap: 8 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: SellerTheme.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  priorityLine: { fontSize: 13, color: Glass.tint.green, fontWeight: '600', lineHeight: 18 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 28,
    paddingVertical: 2,
  },
  bullet: { fontSize: 14, color: SellerTheme.textSecondary, width: 10 },
  lineText: { flex: 1, fontSize: 14, color: SellerTheme.text, fontWeight: '600' },
  muted: { color: SellerTheme.textSecondary },
  doneBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  doneBtnText: { fontSize: 13, fontWeight: '700', color: Glass.tint.blue },
});
