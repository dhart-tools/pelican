# Pelican Sandbox

A React + Redux + React Router + react-i18next app with Cypress tests designed to exercise **every Pelican scorer and analyzer**.

## Setup

```bash
cd sandbox
npm install
npm run dev          # start Vite dev server on :5173
npm run cypress:open # open Cypress test runner
```

## Scorer Coverage Map

| Scorer | Source file(s) | Cypress test(s) | How it fires |
|---|---|---|---|
| `direct-import` | `LoginForm.tsx` | `login.cy.ts` | Test directly imports the component |
| `transitive-import` | `ProductCard.tsx` | `products.cy.ts` | Test → ProductList → ProductCard |
| `route-match` | `LoginPage`, `ProductsPage`, `CartPage`, `RegisterPage`, `HomePage` | `login.cy.ts`, `products.cy.ts`, `cart.cy.ts`, `register.cy.ts`, `home.cy.ts` | `cy.visit('/login')` maps to LoginPage which renders LoginForm |
| `redux-chain` | `cartSlice.ts`, `authSlice.ts` | `cart.cy.ts`, `navigation.cy.ts` | CartItem dispatches to cartSlice; test targets a consumer |
| `redux-consumer` | `CartSummary.tsx`, `ProductList.tsx`, `Navbar.tsx` | `cart.cy.ts`, `products.cy.ts`, `navigation.cy.ts` | Route renders a component that reads slice state |
| `selector-match` | `LoginForm`, `ProductCard`, `CartSummary`, `CartItem`, `Navbar` | All test files | `data-testid` / `data-cy` in source match `cy.get('[data-testid=...]')` |
| `selector-id-match` | `LoginForm` (`id="login-form"`), `CartSummary` (`id="cart-checkout-section"`) | `login.cy.ts`, `cart.cy.ts` | `cy.get('#login-form')` matches `id=` attribute in source |
| `translation-match` | All components using `t()` | All test files | `cy.contains('Sign In')` maps to `t('auth.signIn')` via translation index |
| `api-intercept` | `src/api/auth.ts`, `src/api/products.ts`, `src/api/orders.ts` | `login.cy.ts`, `register.cy.ts`, `products.cy.ts`, `cart.cy.ts` | `cy.intercept('POST', '/api/auth/*')` matches file at `src/api/auth.ts` |
| `filename-match` | `HomePage.tsx` | `home.cy.ts` | `home.cy.ts` vs `HomePage.tsx` — normalized "home" partial match |

## Analyzer Configuration

All analyzers are enabled in `.suggestorrc.json`:

- **source-extractor** — scans `src/**` for `data-testid`, `data-cy`, `id`, `t()` calls
- **cypress-extractor** — scans `cypress/e2e/**/*.cy.ts` for `cy.visit`, `cy.get`, `cy.contains`, `cy.intercept`
- **import-graph-analyzer** — builds the full transitive import graph
- **route-analyzer** — reads `src/App.tsx` for `<Route path=... element=...>` mappings
- **redux-chain-analyzer** — scans `src/store/**` for slice → consumer chains
- **i18n-analyzer** — reads `public/locales/en/translation.json` for key → text index

## Running Pelican against the sandbox

From the `sandbox/` directory:

```bash
# After building pelican (npm run build in repo root):
npx suggestor registry build
npx suggestor analyze --changed src/components/auth/LoginForm.tsx
```

Expected output:
```
● login.cy.ts           HIGH   0.95
  ├─ direct-import      ████████████████████  1.0
  ├─ selector-match     ██████████████████░░  0.90
  └─ translation-match  █████████████████░░░  0.85
```
