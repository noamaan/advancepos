// ── Data model (Firestore documents) ────────────────────────────────────────

export type Role = 'developer' | 'admin' | 'manager' | 'cashier';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: Role;
  /** per-permission overrides: true = force-enable, false = force-disable */
  permOverrides: Record<string, boolean>;
  active: boolean;
  createdAt: number;
  createdBy: string;
  lastActiveAt?: number;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  brand: string;
  size: string; // e.g. "650ml", "500ml can"
  unit: string; // e.g. "bottle", "can", "crate"
  barcode: string; // EAN-13/UPC/Code128 printed on the pack — scanned at billing
  purchasePrice: number;
  sellingPrice: number;
  stockQty: number;
  lowStockThreshold: number | null; // null → use global default from settings
  active: boolean;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}

export interface SaleItem {
  productId: string;
  name: string;
  size: string;
  unit: string;
  qty: number;
  price: number; // selling price charged
  purchasePrice: number; // snapshot → for profit reports
  lineTotal: number;
}

export type PaymentMethod = 'cash' | 'upi';
export type PaymentStatus = 'pending' | 'success' | 'failed' | 'refunded';

export interface Sale {
  id: string; // idempotency key — generated client-side
  billNo: string;
  items: SaleItem[];
  subtotal: number;
  discount: number; // flat ₹
  discountPct: number; // % applied (informational)
  taxRate: number; // % applied
  tax: number;
  total: number;
  profit: number; // snapshot of estimated gross profit
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  cashierId: string;
  cashierName: string;
  createdAt: number;
  paidAt: number | null;
  verifiedBy: string | null; // who confirmed a UPI payment
  verifiedAt: number | null;
  failReason: string | null;
  refunded: boolean;
  refundedAt: number | null;
  refundedBy: string | null;
  refundNote: string | null;
  stockDeducted: boolean; // true once stock has been (atomically) deducted
  stockRestored: boolean;
}

export type MovementType = 'purchase' | 'sale' | 'adjustment' | 'refund' | 'import';

export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  type: MovementType;
  qtyDelta: number; // +in / −out
  balanceAfter: number;
  refId: string; // saleId / purchaseId / etc. (idempotency anchor)
  note: string;
  createdAt: number;
  createdBy: string;
}

export interface Purchase {
  id: string;
  productId: string;
  productName: string;
  qty: number;
  unitCost: number;
  total: number;
  supplier: string;
  invoiceNo: string;
  note: string;
  createdAt: number;
  createdBy: string;
}

export interface BusinessSettings {
  bizName: string;
  address: string;
  phone: string;
  email: string;
  logoUrl: string; // Firebase Storage download URL (may be '')
  upiId: string; // e.g. shopname@upi
  upiPayeeName: string;
  currency: string; // '₹'
  taxRate: number; // % default tax
  invoicePrefix: string; // e.g. "MBS-"
  paperSize: '58' | '80'; // mm thermal paper
  lowStockDefault: number;
  categories: string[];
  thankYouNote: string;
  updatedBy?: string;
  updatedAt?: number;
}

export interface AuditLog {
  id: string;
  actorId: string;
  actorName: string;
  action: string; // e.g. 'product.create', 'sale.refund'
  entity: string; // collection or module
  entityId: string;
  summary: string;
  createdAt: number;
}

export const DEFAULT_SETTINGS: BusinessSettings = {
  bizName: 'My Beer Shop',
  address: '',
  phone: '',
  email: '',
  logoUrl: '',
  upiId: '',
  upiPayeeName: 'My Beer Shop',
  currency: '₹',
  taxRate: 0,
  invoicePrefix: 'MBS-',
  paperSize: '80',
  lowStockDefault: 10,
  categories: ['Beer', 'Strong Beer', 'Craft Beer', 'Cider', 'Snacks', 'Other'],
  thankYouNote: 'Thank you! Visit again. Drink responsibly.',
};

// Cart line used by the POS before it becomes a SaleItem
export interface CartLine {
  product: Product;
  qty: number;
  discount: number; // flat ₹ off this line
}
