import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Brand } from '@/constants/Brand';

interface Product {
  id: string;
  name: string;
  description: string;
  price: string;
  category: string;
  includes: string[];
  icon: string;
}

const featuredProducts: Product[] = [
  {
    id: 'fw-1',
    name: 'Ultraboost 24',
    description: 'Premium running shoes with Boost cushioning and Primeknit upper',
    price: '₹15,999',
    category: "Men's Footwear",
    includes: ['Boost midsole', 'Continental rubber outsole', 'Sizes 7–12'],
    icon: 'footsteps',
  },
  {
    id: 'fw-2',
    name: 'Samba OG',
    description: 'Iconic lifestyle sneaker with suede toe cap and gum sole',
    price: '₹9,999',
    category: "Men's Footwear",
    includes: ['Classic terrace style', 'Cloud White / Core Black', 'Sizes 7–12'],
    icon: 'walk',
  },
  {
    id: 'cl-1',
    name: 'Trefoil Hoodie',
    description: 'Fleece blend hoodie with iconic Trefoil logo',
    price: '₹4,499',
    category: "Men's Apparel",
    includes: ['Kangaroo pocket', 'Black / Grey / Green', 'S–XXL'],
    icon: 'shirt',
  },
  {
    id: 'cl-2',
    name: 'Optime Training Leggings',
    description: 'High-waist squat-proof leggings for gym and yoga',
    price: '₹3,499',
    category: "Women's Apparel",
    includes: ['High waist', 'XS–XL', 'Black / Navy / Maroon'],
    icon: 'body',
  },
  {
    id: 'eq-1',
    name: 'Tiro League Football',
    description: 'FIFA Quality machine-stitched ball for grass and turf',
    price: '₹1,999',
    category: 'Sports Equipment',
    includes: ['Size 5', 'Match & training', 'Durable casing'],
    icon: 'football',
  },
  {
    id: 'eq-2',
    name: 'Tiro 23 Training Backpack',
    description: '30L backpack with boot compartment and water-resistant base',
    price: '₹2,999',
    category: 'Bags & Accessories',
    includes: ['Boot compartment', 'Team sports ready', '30L capacity'],
    icon: 'bag',
  },
];

const bundles = [
  {
    name: 'Run Ready Bundle',
    description: 'Supernova Rise + Own The Run Tee + Running Shorts',
    price: '₹16,999',
    originalPrice: '₹19,497',
  },
  {
    name: 'Football Starter Kit',
    description: 'X Crazyfast.3 TF + Tiro Pants + Ball + Shin Guards',
    price: '₹9,999',
    originalPrice: '₹12,497',
  },
  {
    name: "Women's Gym Essentials",
    description: 'Optime Leggings + Powerreact Sports Bra + Yoga Mat',
    price: '₹7,499',
    originalPrice: '₹8,997',
  },
];

interface ServicesShowcaseProps {
  bottomPadding?: number;
}

export default function ServicesShowcase({ bottomPadding = 24 }: ServicesShowcaseProps) {
  const renderProduct = (product: Product) => (
    <View key={product.id} style={styles.productCard}>
      <View style={styles.productHeader}>
        <View style={styles.iconContainer}>
          <Ionicons name={product.icon as any} size={24} color={Brand.colors.primary} />
        </View>
        <View style={styles.productInfo}>
          <Text style={styles.productName}>{product.name}</Text>
          <Text style={styles.productCategory}>{product.category}</Text>
          <Text style={styles.productPrice}>{product.price}</Text>
        </View>
      </View>

      <Text style={styles.productDescription}>{product.description}</Text>

      <View style={styles.includesContainer}>
        {product.includes.map((item, index) => (
          <Text key={index} style={styles.includesItem}>
            • {item}
          </Text>
        ))}
      </View>
    </View>
  );

  const renderBundle = (bundle: typeof bundles[0], index: number) => (
    <View key={index} style={styles.bundleCard}>
      <Text style={styles.bundleName}>{bundle.name}</Text>
      <Text style={styles.bundleDescription}>{bundle.description}</Text>
      <View style={styles.bundlePricing}>
        <Text style={styles.bundlePrice}>{bundle.price}</Text>
        <Text style={styles.bundleOriginal}>{bundle.originalPrice}</Text>
      </View>
    </View>
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Featured Products</Text>
        <Text style={styles.subtitle}>
          Browse our catalog — ask the Sales Consultant for personalised recommendations
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Top Picks</Text>
        {featuredProducts.map(renderProduct)}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Value Bundles</Text>
        {bundles.map(renderBundle)}
      </View>

      <View style={styles.policyInfo}>
        <Text style={styles.policyTitle}>Shopping Information</Text>
        <View style={styles.policyItem}>
          <Ionicons name="car" size={16} color={Brand.colors.primary} />
          <Text style={styles.policyText}>Free shipping on orders above ₹2,999</Text>
        </View>
        <View style={styles.policyItem}>
          <Ionicons name="refresh" size={16} color={Brand.colors.primary} />
          <Text style={styles.policyText}>30-day free returns on unworn items</Text>
        </View>
        <View style={styles.policyItem}>
          <Ionicons name="card" size={16} color={Brand.colors.primary} />
          <Text style={styles.policyText}>UPI, cards, EMI & COD available</Text>
        </View>
        <View style={styles.policyItem}>
          <Ionicons name="storefront" size={16} color={Brand.colors.primary} />
          <Text style={styles.policyText}>120+ Adidas stores across India</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    backgroundColor: Brand.colors.background,
  },
  header: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 8,
    color: Brand.colors.primary,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    color: Brand.colors.muted,
    lineHeight: 20,
    paddingHorizontal: 12,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
    color: Brand.colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  productCard: {
    padding: 16,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: Brand.colors.border,
    marginBottom: 12,
    backgroundColor: Brand.colors.accent,
  },
  productHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 0,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    backgroundColor: Brand.colors.background,
    borderWidth: 1,
    borderColor: Brand.colors.border,
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
    color: Brand.colors.primary,
  },
  productCategory: {
    fontSize: 12,
    color: Brand.colors.muted,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  productPrice: {
    fontSize: 18,
    fontWeight: '800',
    color: Brand.colors.primary,
  },
  productDescription: {
    fontSize: 14,
    marginBottom: 10,
    lineHeight: 20,
    color: Brand.colors.muted,
  },
  includesContainer: {
    marginTop: 4,
  },
  includesItem: {
    fontSize: 13,
    marginBottom: 2,
    color: Brand.colors.highlight,
  },
  bundleCard: {
    padding: 16,
    borderRadius: 0,
    borderWidth: 2,
    borderColor: Brand.colors.primary,
    marginBottom: 12,
    backgroundColor: Brand.colors.accent,
  },
  bundleName: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
    color: Brand.colors.primary,
  },
  bundleDescription: {
    fontSize: 13,
    marginBottom: 8,
    color: Brand.colors.muted,
  },
  bundlePricing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bundlePrice: {
    fontSize: 18,
    fontWeight: '800',
    color: Brand.colors.primary,
  },
  bundleOriginal: {
    fontSize: 14,
    color: Brand.colors.muted,
    textDecorationLine: 'line-through',
  },
  policyInfo: {
    padding: 16,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: Brand.colors.border,
    marginBottom: 24,
    backgroundColor: Brand.colors.accent,
  },
  policyTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
    color: Brand.colors.primary,
  },
  policyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  policyText: {
    fontSize: 14,
    marginLeft: 8,
    flex: 1,
    color: Brand.colors.muted,
  },
});
