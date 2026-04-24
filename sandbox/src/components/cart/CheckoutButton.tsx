// SCENARIO 5: dependent-selector + SCENARIO 7: drift recall.
// This component owns NO data-testid; ParentCheckoutPanel wraps it with
// data-testid="checkout-panel". Test queries the wrapper.
// Expected: dependent-selector fires when CheckoutButton changes.
//
// Drift case: test ALSO references data-testid="confirm-checkout" which
// USED to live here but was removed — selector-match should miss, leaving
// only the wrapper signal + filename hints.

interface CheckoutButtonProps {
  disabled?: boolean;
  onClick: () => void;
  label: string;
}

export function CheckoutButton({ disabled, onClick, label }: CheckoutButtonProps) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
}
