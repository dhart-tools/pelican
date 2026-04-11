// ReduxChainScorer target
// ProductList is a consumer of this slice.

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { Product } from '../api/products';

export interface ProductState {
  items: Product[];
  loading: boolean;
  error: string | null;
  selectedProduct: Product | null;
}

const initialState: ProductState = {
  items: [],
  loading: false,
  error: null,
  selectedProduct: null,
};

export const productSlice = createSlice({
  name: 'products',
  initialState,
  reducers: {
    setProducts: (state, action: PayloadAction<Product[]>) => {
      state.items = action.payload;
      state.loading = false;
      state.error = null;
    },
    setProductsLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setProductsError: (state, action: PayloadAction<string>) => {
      state.error = action.payload;
      state.loading = false;
    },
    selectProduct: (state, action: PayloadAction<Product>) => {
      state.selectedProduct = action.payload;
    },
  },
});

export const { setProducts, setProductsLoading, setProductsError, selectProduct } =
  productSlice.actions;

export const selectProducts = (state: { products: ProductState }) => state.products.items;
export const selectProductsLoading = (state: { products: ProductState }) =>
  state.products.loading;

export default productSlice.reducer;
