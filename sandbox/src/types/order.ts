// SCENARIO 3: pure types — should NOT match anything above threshold.
// Probes precision: type-only edits shouldn't trigger spurious test runs.

export interface Order {
  id: string;
  userId: string;
  items: OrderLineItem[];
  total: number;
  currency: string;
  status: OrderStatus;
  placedAt: string;
}

export interface OrderLineItem {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'delivered' | 'refunded';

export interface OrderSummary {
  count: number;
  totalSpend: number;
}
