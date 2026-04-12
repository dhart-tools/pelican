// RouteMatchScorer — route /cart maps to CartPage
// ReduxConsumerScorer — CartSummary reads cartSlice

import { CartSummary } from '../components/cart/CartSummary';

export function CartPage() {
  return (
    <main data-testid="cart-page">
      <CartSummary />
    </main>
  );
}
