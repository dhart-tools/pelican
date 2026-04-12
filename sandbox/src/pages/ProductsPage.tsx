// RouteMatchScorer — route /products maps to ProductsPage
// ReduxConsumerScorer — ProductList (rendered here) reads productSlice

import { ProductList } from '../components/products/ProductList';

export function ProductsPage() {
  return (
    <main data-testid="products-page">
      <ProductList />
    </main>
  );
}
