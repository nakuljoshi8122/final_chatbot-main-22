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
import { usePeriodicBounce } from '@/shared/hooks/usePeriodicBounce';
import {
  type BuyerAlert,
  buyerAlertSignature,
  loadBuyerNotifySeenSig,
  saveBuyerNotifySeenSig,
} from '@/services/buyerNotifyApi';

type Props = {
  storeId: string;
  storeName?: string;
  alerts: BuyerAlert[];
  bottomOffset?: number;
  onAlertPress?: (alert: BuyerAlert) => void;
};

const ICON: Record<BuyerAlert['type'], keyof typeof Ionicons.glyphMap> = {
  restock: 'refresh-circle-outline',
  low_stock: 'alert-circle-outline',
  discount: 'pricetag-outline',
};

export default function BuyerNotifyFab({
  storeId,
  storeName,
  alerts,
  bottomOffset = 0,
  onAlertPress,
}: Props) {
  const [open, setOpen] = useState(false);
  const [seenSig, setSeenSig] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  const sig = useMemo(() => buyerAlertSignature(alerts), [alerts]);
  const hasAlerts = alerts.length > 0;
  const shouldBounce = hasAlerts && seenSig !== sig;
  const bounceY = usePeriodicBounce(shouldBounce);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadBuyerNotifySeenSig(storeId);
      if (!cancelled) setSeenSig(saved);
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  const markSeen = async () => {
    setSeenSig(sig);
    await saveBuyerNotifySeenSig(storeId, sig);
  };

  const fabBottom = Math.max(insets.bottom, 8) + bottomOffset + 72;

  if (!hasAlerts) return null;

  return (
    <>
      <Animated.View style={[styles.fabWrap, { bottom: fabBottom, transform: [{ translateY: bounceY }] }]}>
        <TouchableOpacity
          style={styles.fab}
          onPress={() => {
            void markSeen();
            setOpen(true);
          }}
          activeOpacity={0.85}
          accessibilityLabel="Open shop updates"
        >
          <Ionicons name="notifications-outline" size={22} color="#fff" />
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{alerts.length}</Text>
          </View>
        </TouchableOpacity>
      </Animated.View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.dialog} onPress={(e) => e.stopPropagation()}>
            <View style={styles.dialogHeader}>
              <View style={styles.dialogTitleRow}>
                <Ionicons name="notifications-outline" size={18} color="#1D3557" />
                <Text style={styles.dialogTitle}>For you</Text>
              </View>
              <TouchableOpacity
                onPress={() => setOpen(false)}
                hitSlop={12}
                style={styles.closeBtn}
                accessibilityLabel="Close updates"
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
              <Text style={styles.intro}>
                {storeName ? `Updates from ${storeName}` : 'Updates for this shop'}
              </Text>
              {alerts.map((a) => (
                <TouchableOpacity
                  key={a.key}
                  style={styles.alertRow}
                  onPress={() => {
                    setOpen(false);
                    onAlertPress?.(a);
                  }}
                  activeOpacity={0.65}
                >
                  <View style={styles.alertIcon}>
                    <Ionicons name={ICON[a.type]} size={18} color="#1D3557" />
                  </View>
                  <View style={styles.alertText}>
                    <Text style={styles.alertTitle}>{a.title}</Text>
                    <Text style={styles.alertMessage}>{a.message}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color="#C2CBD6" />
                </TouchableOpacity>
              ))}
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
    backgroundColor: '#111',
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
  dialogBody: { padding: 16, gap: 10, paddingBottom: 20 },
  intro: { fontSize: 13, color: '#8A929C', marginBottom: 4 },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  alertIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#EAF0F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertText: { flex: 1, gap: 2 },
  alertTitle: { fontSize: 14, fontWeight: '800', color: '#111' },
  alertMessage: { fontSize: 13, color: '#555', lineHeight: 18 },
});
