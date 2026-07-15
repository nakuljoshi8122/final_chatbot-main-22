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
import { ChatTable } from '@/utils/parseTiles';

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
    <View style={styles.wrapper}>
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
    </View>
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
  },
  scrollContent: {
    flexGrow: 1,
    width: '100%',
  },
  table: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: '#000000',
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
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  bodyRowAlt: {
    backgroundColor: '#F7F7F7',
  },
  cellWrap: {
    borderRightWidth: 1,
    borderRightColor: '#E0E0E0',
    justifyContent: 'center',
  },
  bodyCell: {
    fontSize: 13,
    lineHeight: 18,
    color: '#000000',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  boldCell: {
    fontWeight: '700',
  },
  linkCell: {
    color: '#000000',
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
  lastCell: {
    borderRightWidth: 0,
  },
});
