// Scorer coverage:
//   SelectorMatchScorer   — data-testid="navbar", "nav-home", "nav-products", "nav-cart", "nav-logout"
//   TranslationMatchScorer — t('common.home')
//   TransitiveImportScorer — navigation.cy.ts imports Navbar, Navbar imports CartSummary (indirect chain)
//   ReduxConsumerScorer   — reads selectCartCount from cartSlice; route / renders Navbar

import { useSelector, useDispatch } from 'react-redux';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { selectCartCount } from '../../store/cartSlice';
import { selectIsAuthenticated, logoutUser } from '../../store/authSlice';
import type { AppDispatch } from '../../store';

export function Navbar() {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const cartCount = useSelector(selectCartCount);
  const isAuthenticated = useSelector(selectIsAuthenticated);

  return (
    <nav data-testid="navbar">
      <Link data-testid="nav-home" to="/">
        {t('common.home')}
      </Link>
      <Link data-testid="nav-products" to="/products">
        {t('products.title')}
      </Link>
      <Link data-testid="nav-cart" to="/cart">
        {t('cart.title')} ({cartCount})
      </Link>
      {isAuthenticated && (
        <button data-testid="nav-logout" onClick={() => dispatch(logoutUser())}>
          Logout
        </button>
      )}
    </nav>
  );
}
