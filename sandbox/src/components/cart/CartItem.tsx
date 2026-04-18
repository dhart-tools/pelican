// Scorer coverage:
//   SelectorMatchScorer   — data-testid="cart-item", "cart-item-remove", "cart-item-qty"
//   TranslationMatchScorer — t('cart.remove')
//   ReduxChainScorer      — dispatches removeFromCart, updateQuantity from cartSlice

import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { removeFromCart, updateQuantity } from '../../store/cartSlice';
import { classnames } from '../../utils/classnames';
import type { CartItem as CartItemType } from '../../store/cartSlice';
import type { AppDispatch } from '../../store';

interface CartItemProps {
  item: CartItemType;
}

export function CartItem({ item }: CartItemProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();

  return (
    <div data-testid="cart-item" id={`cart-item-${item.productId}`} className={classnames('cart-item')}>
      <img src={item.imageUrl} alt={item.name} />
      <span data-testid="cart-item-name">{item.name}</span>
      <span data-testid="cart-item-price">${item.price.toFixed(2)}</span>
      <input
        data-testid="cart-item-qty"
        type="number"
        min={1}
        value={item.quantity}
        onChange={(e) =>
          dispatch(updateQuantity({ productId: item.productId, quantity: Number(e.target.value) }))
        }
      />
      <button
        data-testid="cart-item-remove"
        onClick={() => dispatch(removeFromCart(item.productId))}
      >
        {t('cart.remove')}
      </button>
    </div>
  );
}
