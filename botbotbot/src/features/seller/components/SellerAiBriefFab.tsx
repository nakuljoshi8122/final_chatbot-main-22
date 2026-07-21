import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  ScrollView,
  Platform,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tapHaptic } from '@/shared/utils/sellerHaptics';
import { usePeriodicBounce } from '@/shared/hooks/usePeriodicBounce';
import { loadBriefSeenSig, saveBriefSeenSig } from '@/services/sellerLazyStore';
import type { MorningBriefStats } from '@/features/seller/components/SellerMorningBrief';

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
}: Props) {
  const [open, setOpen] = useState(false);
  const [seenSig, setSeenSig] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  const urgentCount =
    (stats.lowStock > 0 && !done?.lowStock ? 1 : 0) +
    (stats.drafts > 0 && !done?.drafts ? 1 : 0) +
    (stats.queries > 0 && !done?.queries ? 1 : 0);

  const sig = useMemo(() => briefSignature(stats, done), [stats, done]);
  const shouldBounce = urgentCount > 0 && seenSig !== sig;
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

  return (
    <>
      <Animated.View style={[styles.fabWrap, { bottom: fabBottom, transform: [{ translateY: bounceY }] }]}>
        <TouchableOpacity
          style={styles.fab}
          onPress={() => {
            tapHaptic();
            void markSeen();
            setOpen(true);
          }}
          activeOpacity={0.85}
          accessibilityLabel="Open AI brief"
        >
          <Ionicons name="sparkles" size={22} color="#fff" />
          {urgentCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{urgentCount}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      </Animated.View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.dialog} onPress={(e) => e.stopPropagation()}>
            <View style={styles.dialogHeader}>
              <View style={styles.dialogTitleRow}>
                <Ionicons name="sparkles" size={18} color="#1D3557" />
                <Text style={styles.dialogTitle}>AI Brief</Text>
              </View>
              <TouchableOpacity
                onPress={() => setOpen(false)}
                hitSlop={12}
                style={styles.closeBtn}
                accessibilityLabel="Close brief"
              >
                <Ionicons name="close" size={22} color="#555" />
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
                      <Ionicons name="chevron-forward" size={14} color="#C2CBD6" />
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
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fabWrap: {
    position: 'absolute',
    right: 16,
    zIndex: 20,
  },
  fab: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#1D3557',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.22,
        shadowRadius: 6,
      },
      android: { elevation: 6 },
    }),
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#E63946',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: '#F5F5F5',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialog: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '72%',
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 24,
      },
      android: { elevation: 12 },
    }),
  },
  dialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
  },
  dialogTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dialogTitle: { fontSize: 16, fontWeight: '800', color: '#111' },
  closeBtn: { padding: 4 },
  dialogScroll: { flexGrow: 0 },
  dialogBody: { padding: 16, gap: 14, paddingBottom: 20 },
  aiBox: {
    backgroundColor: '#F0F4FA',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  aiText: { fontSize: 14, lineHeight: 20, color: '#334155', fontWeight: '500' },
  aiTextMuted: { fontSize: 13, color: '#8A929C', fontStyle: 'italic' },
  section: { gap: 8 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#9AA3AE',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  priorityLine: { fontSize: 13, color: '#1B7A3D', fontWeight: '600', lineHeight: 18 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 28,
    paddingVertical: 2,
  },
  bullet: { fontSize: 14, color: '#9AA3AE', width: 10 },
  lineText: { flex: 1, fontSize: 14, color: '#444', fontWeight: '600' },
  muted: { color: '#B4BAC2' },
  doneBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  doneBtnText: { fontSize: 13, fontWeight: '700', color: '#1D3557' },
});
