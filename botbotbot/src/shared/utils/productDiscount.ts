export type ProductDiscount = {
  originalAmount: number;
  saleAmount: number;
  percentOff: number;
};

export function parsePriceAmount(value?: string): number {
  const amount = Number.parseFloat(String(value || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

export function getProductDiscount(
  price?: string,
  listPrice?: string,
): ProductDiscount | null {
  const saleAmount = parsePriceAmount(price);
  const originalAmount = parsePriceAmount(listPrice);
  if (saleAmount <= 0 || originalAmount <= saleAmount) return null;

  return {
    originalAmount,
    saleAmount,
    percentOff: Math.max(
      1,
      Math.min(99, Math.round(((originalAmount - saleAmount) / originalAmount) * 100)),
    ),
  };
}

export function withDollar(value?: string): string {
  const price = String(value || '').trim();
  if (!price) return '';
  return price.startsWith('$') ? price : `$${price}`;
}
