// SCENARIO 2 source-of-truth — emits the ORDER_* actions.

import {
  ORDER_CHECKOUT_REQUESTED,
  ORDER_CHECKOUT_SUCCEEDED,
  ORDER_CHECKOUT_FAILED,
} from './orderActionTypes';

export interface SagaAction {
  type: string;
  payload?: unknown;
}

export async function checkoutSaga(items: unknown[]): Promise<SagaAction> {
  const start: SagaAction = { type: ORDER_CHECKOUT_REQUESTED, payload: { items } };
  void start;
  try {
    await new Promise((r) => setTimeout(r, 50));
    return { type: ORDER_CHECKOUT_SUCCEEDED, payload: { orderId: 'ord-1' } };
  } catch (e) {
    return { type: ORDER_CHECKOUT_FAILED, payload: { error: String(e) } };
  }
}
