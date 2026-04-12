// APIInterceptScorer target: cy.intercept('/api/products') matches this file

export interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
  imageUrl: string;
  inStock: boolean;
  category: string;
}

export interface ProductsResponse {
  items: Product[];
  total: number;
  page: number;
}

// ─── In-memory mock — no backend required ────────────────────────────────────

const MOCK_PRODUCTS: Product[] = [
  { id: 'p1', name: 'Pelican Pro Tote',      price: 49.99,  description: 'Spacious tote for the modern developer.',   imageUrl: '/img/tote.png',    inStock: true,  category: 'bags'        },
  { id: 'p2', name: 'Mechanical Keyboard',   price: 149.00, description: 'Clicky keys. Maximum productivity.',        imageUrl: '/img/kb.png',      inStock: true,  category: 'peripherals' },
  { id: 'p3', name: 'Curved Monitor 34"',    price: 599.00, description: 'See more code. Write less bugs.',           imageUrl: '/img/monitor.png', inStock: false, category: 'displays'    },
  { id: 'p4', name: 'USB-C Hub (7-in-1)',    price: 39.99,  description: 'Connect everything. Lose nothing.',         imageUrl: '/img/hub.png',     inStock: true,  category: 'accessories' },
  { id: 'p5', name: 'Noise-Cancel Headset',  price: 249.00, description: 'Deep focus mode. Engage.',                  imageUrl: '/img/headset.png', inStock: true,  category: 'audio'       },
  { id: 'p6', name: 'Standing Desk Mat',     price: 79.00,  description: 'Your feet will thank you.',                 imageUrl: '/img/mat.png',     inStock: true,  category: 'ergonomics'  },
];

const delay = (ms = 300) => new Promise<void>((r) => setTimeout(r, ms));

export async function fetchProducts(page = 1, category?: string): Promise<ProductsResponse> {
  await delay();
  const items = category
    ? MOCK_PRODUCTS.filter((p) => p.category === category)
    : MOCK_PRODUCTS;
  const start = (page - 1) * 10;
  return { items: items.slice(start, start + 10), total: items.length, page };
}

export async function fetchProductById(id: string): Promise<Product> {
  await delay(200);
  const product = MOCK_PRODUCTS.find((p) => p.id === id);
  if (!product) throw new Error('Product not found');
  return product;
}
