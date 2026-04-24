// SCENARIO 5 wrapper — provides the data-testid the test queries.

import { useState } from 'react';
import { CheckoutButton } from './CheckoutButton';

export function CheckoutPanel() {
  const [busy, setBusy] = useState(false);
  return (
    <div data-testid="checkout-panel">
      <CheckoutButton
        disabled={busy}
        label={busy ? 'Processing...' : 'Confirm checkout'}
        onClick={() => setBusy(true)}
      />
    </div>
  );
}
