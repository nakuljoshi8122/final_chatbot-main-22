import { SellerCategory } from '@/shared/theme/SellerTheme';

/** One-tap name + price presets so lazy sellers barely type. */
export type ProductTemplate = {
  name: string;
  price: string;
  quantity: number;
};

export const CATEGORY_TEMPLATES: Record<SellerCategory, ProductTemplate[]> = {
  Skincare: [
    { name: 'Vitamin C Serum', price: '28', quantity: 10 },
    { name: 'Hydrating Moisturizer', price: '24', quantity: 10 },
    { name: 'Gentle Cleanser', price: '18', quantity: 12 },
    { name: 'SPF Day Cream', price: '32', quantity: 10 },
  ],
  Apparel: [
    { name: 'Cotton Tee', price: '22', quantity: 15 },
    { name: 'Linen Shirt', price: '45', quantity: 8 },
    { name: 'Everyday Hoodie', price: '55', quantity: 10 },
    { name: 'Canvas Tote', price: '18', quantity: 20 },
  ],
  Handicrafts: [
    { name: 'Handmade Ceramic Mug', price: '16', quantity: 12 },
    { name: 'Woven Basket', price: '28', quantity: 8 },
    { name: 'Carved Wood Bowl', price: '35', quantity: 6 },
    { name: 'Block-print Scarf', price: '30', quantity: 10 },
  ],
};

export const PRICE_PRESETS = ['12', '18', '24', '28', '35', '45'];
