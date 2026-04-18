// Scorer coverage:
//   SelectorMatchScorer   — data-testid="product-card", "add-to-cart-btn", "product-price"
//   SelectorIdMatchScorer — id="product-{id}" (dynamic, resolved by test)
//   TranslationMatchScorer — t('products.addToCart'), t('products.outOfStock')
//   ReduxChainScorer      — dispatches addToCart → cartSlice is in the cart chain

import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { addToCart } from '../../store/cartSlice';
import { usePriceFormatter } from '../../hooks/usePriceFormatter';
import { classnames } from '../../utils/classnames';
import type { Product } from '../../api/products';
import type { AppDispatch } from '../../store';

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const formatPrice = usePriceFormatter();

  function handleAddToCart() {
    dispatch(
      addToCart({
        productId: product.id,
        name: product.name,
        price: product.price,
        quantity: 1,
        imageUrl: product.imageUrl,
      }),
    );
  }

  return (
    <div data-testid="product-card" id={`product-${product.id}`} className={classnames('product-card', { 'out-of-stock': !product.inStock })}>
      <img src={product.imageUrl} alt={product.name} />
      <h3>{product.name}</h3>
      <p data-testid="product-price">
        {t('products.price')}: {formatPrice(product.price)}
      </p>
      {product.inStock ? (
        <button data-testid="add-to-cart-btn" onClick={handleAddToCart}>
          {t('products.addToCart')}
        </button>
      ) : (
        <span data-testid="out-of-stock">{t('products.outOfStock')}</span>
      )}
    </div>
  );
}
