// Scorer coverage:
//   SelectorMatchScorer   — data-testid="product-list", "products-loading", "products-empty"
//   TranslationMatchScorer — t('products.title'), t('products.noProducts'), t('common.loading')
//   ReduxConsumerScorer   — useSelector from productSlice → route /products renders ProductList
//   TransitiveImportScorer — products.cy.ts imports ProductList which imports ProductCard

import { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { selectProducts, selectProductsLoading, setProducts, setProductsLoading } from '../../store/productSlice';
import { fetchProducts } from '../../api/products';
import { ProductCard } from './ProductCard';
import type { AppDispatch } from '../../store';

export function ProductList() {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const products = useSelector(selectProducts);
  const loading = useSelector(selectProductsLoading);

  useEffect(() => {
    dispatch(setProductsLoading(true));
    fetchProducts()
      .then((res) => dispatch(setProducts(res.items)))
      .catch(() => dispatch(setProductsLoading(false)));
  }, [dispatch]);

  if (loading) {
    return <div data-testid="products-loading">{t('common.loading')}</div>;
  }

  if (products.length === 0) {
    return <div data-testid="products-empty">{t('products.noProducts')}</div>;
  }

  return (
    <section data-testid="product-list">
      <h2>{t('products.title')}</h2>
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </section>
  );
}
