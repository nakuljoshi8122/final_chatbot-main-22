/**
 * Liquid Glass light tokens for the seller side (Inventory / List / Chat).
 * Matches the buyer white/frosted look — translucent panes over a pastel aurora
 * backdrop rendered by <GlassScreen scheme="light">.
 */
export const SellerTheme = {
  bg: '#EFF3FE',
  surface: 'rgba(255,255,255,0.72)',
  surfaceElevated: 'rgba(255,255,255,0.88)',
  chipIdle: 'rgba(24,30,54,0.08)',
  chipActive: 'rgba(16,20,37,0.92)',
  chipActiveText: '#F4F6FF',
  text: '#101425',
  /** Secondary copy on light panes — keep ≥0.72 so it stays readable on frost. */
  textSecondary: 'rgba(24,30,54,0.74)',
  border: 'rgba(122,132,166,0.28)',
  danger: '#FF5A5F',
  accent: '#3D7BFF',
  stepperBg: 'rgba(24,30,54,0.08)',
  overlay: 'rgba(16,20,37,0.35)',
  radius: 18,
  radiusSm: 12,
  sellerName: 'My Store',
} as const;

export const SELLER_CATEGORIES = ['Handicrafts', 'Apparel', 'Skincare'] as const;
export type SellerCategory = (typeof SELLER_CATEGORIES)[number];

export const INVENTORY_STATUSES = ['active', 'draft', 'trash'] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];
