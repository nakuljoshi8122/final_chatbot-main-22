import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Linking,
  Platform,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { ChatTable } from '@/shared/utils/parseTiles';
import { GlassPane } from '@/shared/ui/Glass';
import { Glass } from '@/shared/theme/LiquidGlass';

const URL_RE = /^https?:\/\//i;

interface ChatTableViewProps {
  table: ChatTable;
}

function TableCell({ value, style }: { value: string; style: object[] }) {
  if (URL_RE.test(value)) {
    const open = async () => {
      if (Platform.OS === 'web') {
        const opener = (globalThis as { open?: (url: string, target?: string) => void }).open;
        opener?.(value, '_blank');
        return;
      }
      try {
        await WebBrowser.openBrowserAsync(value);
      } catch {
        Linking.openURL(value);
      }
    };
    return (
      <Pressable onPress={open} style={style}>
        <Text style={[styles.bodyCell, styles.linkCell]} numberOfLines={2}>
          View
        </Text>
      </Pressable>
    );
  }

  return (
    <Text style={[styles.bodyCell, ...style]} numberOfLines={3}>
      {value}
    </Text>
  );
}

export default function ChatTableView({ table }: ChatTableViewProps) {
  const colCount = Math.max(
    table.headers.length,
    ...table.rows.map((r) => r.length),
    1,
  );

  const cellFlex = { flex: 1, minWidth: 80 };

  return (
    <GlassPane scheme="light" intensity="regular" noBlur flat style={styles.wrapper} contentStyle={styles.wrapperContent}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.table}>
          {table.headers.length > 0 && (
            <View style={styles.headerRow}>
              {table.headers.map((header, i) => (
                <Text
                  key={`h-${i}`}
                  style={[
                    styles.headerCell,
                    cellFlex,
                    i === table.headers.length - 1 && styles.lastCell,
                  ]}
                >
                  {header}
                </Text>
              ))}
            </View>
          )}
          {table.rows.map((row, rowIndex) => (
            <View
              key={`r-${rowIndex}`}
              style={[styles.bodyRow, rowIndex % 2 === 1 && styles.bodyRowAlt]}
            >
              {Array.from({ length: colCount }).map((_, cellIndex) => {
                const value = row[cellIndex] ?? '';
                const isBold = value.includes('Total') || row[0]?.includes('Total');
                return (
                  <View
                    key={`c-${rowIndex}-${cellIndex}`}
                    style={[
                      cellFlex,
                      styles.cellWrap,
                      cellIndex === colCount - 1 && styles.lastCell,
                    ]}
                  >
                    {URL_RE.test(value) ? (
                      <TableCell value={value} style={[cellFlex]} />
                    ) : (
                      <Text
                        style={[
                          styles.bodyCell,
                          isBold && styles.boldCell,
                        ]}
                        numberOfLines={3}
                      >
                        {value}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </GlassPane>
  );
}

interface ChatTableListProps {
  tables: ChatTable[];
}

export function ChatTableList({ tables }: ChatTableListProps) {
  if (!tables.length) return null;
  return (
    <View style={styles.list}>
      {tables.map((table, index) => (
        <ChatTableView key={index} table={table} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    marginTop: 8,
    gap: 10,
    width: '100%',
  },
  wrapper: {
    width: '100%',
    alignSelf: 'stretch',
    borderRadius: Glass.radius.md,
  },
  wrapperContent: {
    overflow: 'hidden',
  },
  scrollContent: {
    flexGrow: 1,
    width: '100%',
  },
  table: {
    width: '100%',
    backgroundColor: 'transparent',
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(16,20,37,0.90)',
  },
  headerCell: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRightWidth: 1,
    borderRightColor: '#333333',
  },
  bodyRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.38)',
    borderTopWidth: 1,
    borderTopColor: Glass.stroke.lightOuter,
  },
  bodyRowAlt: {
    backgroundColor: 'rgba(255,255,255,0.24)',
  },
  cellWrap: {
    borderRightWidth: 1,
    borderRightColor: Glass.stroke.lightOuter,
    justifyContent: 'center',
  },
  bodyCell: {
    fontSize: 13,
    lineHeight: 18,
    color: Glass.ink.light,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  boldCell: {
    fontWeight: '700',
  },
  linkCell: {
    color: Glass.tint.blue,
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
  lastCell: {
    borderRightWidth: 0,
  },
});
