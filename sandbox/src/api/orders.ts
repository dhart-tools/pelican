// APIInterceptScorer target: cy.intercept('/api/orders') matches this file

export interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}

export interface Order {
  id: string;
  userId: string;
  items: OrderItem[];
  total: number;
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered';
  createdAt: string;
}

export interface PlaceOrderPayload {
  items: OrderItem[];
}

// ─── In-memory mock — no backend required ────────────────────────────────────

const orders: Order[] = [];
let nextId = 1;

const delay = (ms = 300) => new Promise<void>((r) => setTimeout(r, ms));

export async function placeOrder(payload: PlaceOrderPayload): Promise<Order> {
  await delay();
  const order: Order = {
    id: `order-${nextId++}`,
    userId: 'user-1',
    items: payload.items,
    total: payload.items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    status: 'confirmed',
    createdAt: new Date().toISOString(),
  };
  orders.push(order);
  return order;
}

export async function fetchOrders(): Promise<Order[]> {
  await delay(200);
  return [...orders];
}
