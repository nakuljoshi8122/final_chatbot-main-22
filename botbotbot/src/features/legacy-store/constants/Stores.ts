import type { SellerCategory } from '@/shared/theme/SellerTheme';

export type StoreId = 'skincare' | 'handicrafts' | 'apparels';

export type StoreConfig = {
  id: StoreId;
  /** Button / display label */
  label: string;
  /** Tag sent to the agent so it only picks matching catalog data */
  agentTag: string;
  /** Inventory / KB category label */
  category: SellerCategory;
  /** Domains the backend agent may return for this store */
  domains: string[];
  brandName: string;
  agentTitle: string;
  tagline: string;
  accent: string;
  description: string;
};

export const STORES: StoreConfig[] = [
  {
    id: 'skincare',
    label: 'Skincare',
    agentTag: 'skincare',
    category: 'Skincare',
    domains: ['skincare'],
    brandName: 'Glow Lab',
    agentTitle: 'Skincare Store Assistant',
    tagline: 'Serums, cleansers & daily care',
    accent: '#2D6A4F',
    description: 'Browse skincare only — serums, moisturizers, cleansers.',
  },
  {
    id: 'handicrafts',
    label: 'Handicrafts',
    agentTag: 'handicrafts',
    category: 'Handicrafts',
    domains: ['handicrafts', 'jewellery', 'home'],
    brandName: 'Atelier Craft',
    agentTitle: 'Handicrafts Store Assistant',
    tagline: 'Handmade home & artisan goods',
    accent: '#9C6644',
    description: 'Browse handicrafts only — ceramics, jewellery, decor.',
  },
  {
    id: 'apparels',
    label: 'Apparels',
    agentTag: 'apparels',
    category: 'Apparel',
    domains: ['apparel'],
    brandName: 'Thread & Co',
    agentTitle: 'Apparel Store Assistant',
    tagline: 'Everyday clothing & casual wear',
    accent: '#1D3557',
    description: 'Browse apparel only — shirts, tees, pants & more.',
  },
];

export function getStoreById(id: string | null | undefined): StoreConfig | null {
  if (!id) return null;
  return STORES.find((s) => s.id === id) ?? null;
}

export const STORE_STORAGE_KEY = '@selected_store_id';
