import { API_BASE, fetchWithTimeout } from '@/services/apiBase';
import { SellerCategory } from '@/shared/theme/SellerTheme';

export type ProductVisionGuess = {
  ok: boolean;
  name?: string;
  description?: string;
  category?: SellerCategory | string;
  generalized?: boolean;
  source?: string;
  error?: string;
};

/** Ask the backend vision model to name + describe a product photo. */
export async function guessProductFromImage(
  imageBase64: string,
  categoryHint?: string,
): Promise<ProductVisionGuess | null> {
  if (!imageBase64?.trim()) return null;
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/seller/product-from-image`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: imageBase64,
          category: categoryHint || '',
        }),
      },
      45000,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as ProductVisionGuess;
    if (!data?.name) return null;
    return data;
  } catch {
    return null;
  }
}
