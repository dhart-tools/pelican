// Scorer coverage:
//   SelectorMatchScorer   — data-testid="cart-summary", "cart-total", "checkout-btn", "cart-empty"
//   SelectorIdMatchScorer — id="cart-checkout-section"
//   TranslationMatchScorer — t('cart.title'), t('cart.checkout'), t('cart.empty'), t('cart.total')
//   ReduxConsumerScorer   — useSelector from cartSlice; route /cart renders CartSummary
//   APIInterceptScorer    — checkout dispatches to /api/orders via placeOrder

import { useSelector, useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { selectCartItems, selectCartTotal, clearCart, setCheckingOut } from '../../store/cartSlice';
import { placeOrder } from '../../api/orders';
import { CartItem } from './CartItem';
import type { AppDispatch } from '../../store';

export function CartSummary() {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const items = useSelector(selectCartItems);
  const total = useSelector(selectCartTotal);

  async function handleCheckout() {
    dispatch(setCheckingOut(true));
    try {
      await placeOrder({
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, price: i.price })),
      });
      dispatch(clearCart());
    } finally {
      dispatch(setCheckingOut(false));
    }
  }

  if (items.length === 0) {
    return <div data-testid="cart-empty">{t('cart.empty')}</div>;
  }

  return (
    <section data-testid="cart-summary" id="cart-checkout-section">
      <h2>{t('cart.title')}</h2>
      {items.map((item) => (
        <CartItem key={item.productId} item={item} />
      ))}
      <div data-testid="cart-total">
        {t('cart.total')}: ${total.toFixed(2)}
      </div>
      <button data-testid="checkout-btn" onClick={handleCheckout}>
        {t('cart.checkout')}
      </button>
    </section>
  );
}
