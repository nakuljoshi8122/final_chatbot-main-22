import React from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/ThemedText';
import { Brand } from '@/constants/Brand';
import { useScreenInsets } from '@/hooks/useScreenInsets';

export default function ProfileScreen() {
  const router = useRouter();
  const { contentBottomPadding } = useScreenInsets();
  const handleContact = (type: string, value: string) => {
    switch (type) {
      case 'phone':
        Linking.openURL(`tel:${value}`);
        break;
      case 'email':
        Linking.openURL(`mailto:${value}`);
        break;
      case 'web':
        Linking.openURL(value);
        break;
      default:
        break;
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <ThemedText type="title" style={styles.headerTitle}>
          Adidas Store
        </ThemedText>
        <ThemedText style={styles.headerSubtitle}>
          {Brand.tagline}
        </ThemedText>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: contentBottomPadding }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileCard}>
          <View style={styles.logoContainer}>
            <ThemedText style={styles.logoText}>adidas</ThemedText>
          </View>

          <ThemedText type="title" style={styles.name}>
            {Brand.agentTitle}
          </ThemedText>

          <ThemedText style={styles.profession}>
            Official Store Assistant
          </ThemedText>

          <View style={styles.detailsContainer}>
            <View style={styles.detailRow}>
              <Ionicons name="footsteps" size={20} color={Brand.colors.muted} />
              <ThemedText style={styles.detailText}>
                Footwear for men, women & kids
              </ThemedText>
            </View>

            <View style={styles.detailRow}>
              <Ionicons name="shirt" size={20} color={Brand.colors.muted} />
              <ThemedText style={styles.detailText}>
                Clothing, jerseys & training wear
              </ThemedText>
            </View>

            <View style={styles.detailRow}>
              <Ionicons name="football" size={20} color={Brand.colors.muted} />
              <ThemedText style={styles.detailText}>
                Sports equipment & accessories
              </ThemedText>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Seller
          </ThemedText>
          <TouchableOpacity
            style={styles.sellerButton}
            onPress={() => router.push('/inventory')}
            activeOpacity={0.8}
          >
            <Ionicons name="cube-outline" size={22} color="white" />
            <View style={styles.sellerButtonTextWrap}>
              <ThemedText style={styles.sellerButtonTitle}>Inventory</ThemedText>
              <ThemedText style={styles.sellerButtonSub}>
                Manage listings · Handicrafts, Apparel, Skincare
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.8)" />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Shopping Support
          </ThemedText>
          <ThemedText style={styles.description}>
            Our AI Sales Consultant helps you find the right Adidas products for your
            sport, style, and budget. Share your requirements and receive tailored
            recommendations from our catalog.
          </ThemedText>
        </View>

        <View style={styles.section}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Store Policies
          </ThemedText>
          <View style={styles.highlightsList}>
            <View style={styles.highlightItem}>
              <Ionicons name="checkmark-circle" size={20} color={Brand.colors.primary} />
              <ThemedText style={styles.highlightText}>
                Free shipping on orders above ₹2,999
              </ThemedText>
            </View>
            <View style={styles.highlightItem}>
              <Ionicons name="checkmark-circle" size={20} color={Brand.colors.primary} />
              <ThemedText style={styles.highlightText}>
                30-day free returns on unworn items
              </ThemedText>
            </View>
            <View style={styles.highlightItem}>
              <Ionicons name="checkmark-circle" size={20} color={Brand.colors.primary} />
              <ThemedText style={styles.highlightText}>
                UPI, cards, EMI & COD available
              </ThemedText>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Contact
          </ThemedText>
          <View style={styles.contactButtons}>
            <TouchableOpacity
              style={styles.contactButton}
              onPress={() => handleContact('web', 'https://www.adidas.co.in')}
            >
              <Ionicons name="globe" size={20} color="white" />
              <ThemedText style={styles.contactButtonText}>Website</ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.contactButton}
              onPress={() => handleContact('email', 'support@adidas.com')}
            >
              <Ionicons name="mail" size={20} color="white" />
              <ThemedText style={styles.contactButtonText}>Email</ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Brand.colors.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Brand.colors.border,
    backgroundColor: Brand.colors.accent,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 4,
    color: Brand.colors.primary,
  },
  headerSubtitle: {
    fontSize: 14,
    color: Brand.colors.muted,
    fontStyle: 'italic',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  profileCard: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Brand.colors.border,
    marginVertical: 16,
    backgroundColor: Brand.colors.accent,
  },
  logoContainer: {
    marginBottom: 16,
  },
  logoText: {
    fontSize: 36,
    fontWeight: '900',
    color: Brand.colors.primary,
    letterSpacing: -1,
    textTransform: 'lowercase',
  },
  name: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
    color: Brand.colors.primary,
  },
  profession: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 20,
    textAlign: 'center',
    color: Brand.colors.muted,
  },
  detailsContainer: {
    width: '100%',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  detailText: {
    fontSize: 15,
    marginLeft: 12,
    flex: 1,
    color: Brand.colors.highlight,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    color: Brand.colors.primary,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: Brand.colors.muted,
  },
  highlightsList: {
    marginTop: 8,
  },
  highlightItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  highlightText: {
    fontSize: 15,
    marginLeft: 12,
    flex: 1,
    lineHeight: 22,
    color: Brand.colors.highlight,
  },
  sellerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Brand.colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 4,
    gap: 12,
  },
  sellerButtonTextWrap: {
    flex: 1,
  },
  sellerButtonTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
  },
  sellerButtonSub: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    marginTop: 2,
  },
  contactButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 8,
  },
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 0,
    minWidth: 120,
    justifyContent: 'center',
    backgroundColor: Brand.colors.primary,
  },
  contactButtonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 6,
  },
});
