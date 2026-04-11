// RouteMatchScorer source of truth — all routes declared here.
// The routeAnalyzer reads this file (routerFile: "src/App.tsx") to build the route → component map.
//
// Route map:
//   /           → HomePage
//   /login      → LoginPage
//   /register   → RegisterPage
//   /products   → ProductsPage
//   /cart       → CartPage

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Provider } from 'react-redux';
import { store } from './store';
import { Navbar } from './components/common/Navbar';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ProductsPage } from './pages/ProductsPage';
import { CartPage } from './pages/CartPage';

export function App() {
  return (
    <Provider store={store}>
      <BrowserRouter>
        <Navbar />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/cart" element={<CartPage />} />
        </Routes>
      </BrowserRouter>
    </Provider>
  );
}
