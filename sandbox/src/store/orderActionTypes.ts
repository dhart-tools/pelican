// SCENARIO 2: action-type strings — probes ActionTypeScorer.
// Plain UPPER_SNAKE constants used by sagaWatchers + cypress assertions on
// dispatched payloads. Test references the same literal strings.

export const ORDER_CHECKOUT_REQUESTED = 'order/ORDER_CHECKOUT_REQUESTED';
export const ORDER_CHECKOUT_SUCCEEDED = 'order/ORDER_CHECKOUT_SUCCEEDED';
export const ORDER_CHECKOUT_FAILED = 'order/ORDER_CHECKOUT_FAILED';
export const ORDER_REFUND_INITIATED = 'order/ORDER_REFUND_INITIATED';
