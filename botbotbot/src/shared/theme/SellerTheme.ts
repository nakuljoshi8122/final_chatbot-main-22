/** Dark UI tokens for seller Inventory / List pages (matches Inventory screenshot). */
export const SellerTheme = {
  bg: '#000000',
  surface: '#1C1C1E',
  surfaceElevated: '#2C2C2E',
  chipIdle: '#2C2C2E',
  chipActive: '#E5E5EA',
  chipActiveText: '#000000',
  text: '#FFFFFF',
  textSecondary: '#8E8E93',
  border: '#3A3A3C',
  danger: '#FF453A',
  accent: '#0A84FF',
  stepperBg: '#3A3A3C',
  overlay: 'rgba(0,0,0,0.55)',
  radius: 14,
  radiusSm: 10,
  sellerName: 'Artisan Boutique',
} as const;

export const SELLER_CATEGORIES = ['Handicrafts', 'Apparel', 'Skincare'] as const;
export type SellerCategory = (typeof SELLER_CATEGORIES)[number];

export const INVENTORY_STATUSES = ['active', 'draft', 'trash'] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];
