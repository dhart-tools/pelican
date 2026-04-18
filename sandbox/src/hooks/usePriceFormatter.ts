// SCENARIO 1: deep hook chain — probes UsageSiteScorer.
// Imported by ProductCard which is rendered by ProductList in ProductsPage.
// Expected: editing this file → products.cy.ts surfaces via reverse-dep cone.

import { useTranslation } from 'react-i18next';

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  INR: '₹',
};

export function usePriceFormatter(currency = 'USD') {
  const { t } = useTranslation();
  return (amount: number) => {
    const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
    if (amount <= 0) return t('product.free');
    return `${symbol}${amount.toFixed(2)}`;
  };
}
