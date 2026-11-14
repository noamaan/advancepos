import type { Role, UserProfile } from '../types';

/** Every assignable permission key. */
export const PERMS = {
  billing: { key: 'billing', label: 'Billing / POS checkout', group: 'Sales' },
  verifyPayments: { key: 'verifyPayments', label: 'Verify UPI payments', group: 'Sales' },
  refunds: { key: 'refunds', label: 'Refunds & cancellations', group: 'Sales' },
  viewCost: { key: 'viewCost', label: 'View purchase cost & profit', group: 'Sales' },
  inventoryView: { key: 'inventoryView', label: 'View inventory', group: 'Inventory' },
  inventoryManage: { key: 'inventoryManage', label: 'Add / edit / delete products', group: 'Inventory' },
  stockAdjust: { key: 'stockAdjust', label: 'Adjust stock quantities', group: 'Inventory' },
  purchases: { key: 'purchases', label: 'Record stock purchases', group: 'Inventory' },
  excel: { key: 'excel', label: 'Excel import / export', group: 'Data' },
  reports: { key: 'reports', label: 'View reports & analytics', group: 'Data' },
  transactions: { key: 'transactions', label: 'View transaction history', group: 'Data' },
  settings: { key: 'settings', label: 'Manage shop settings', group: 'Admin' },
  usersView: { key: 'usersView', label: 'View users', group: 'Admin' },
  usersManage: { key: 'usersManage', label: 'Create / edit users & permissions', group: 'Admin' },
  usersDelete: { key: 'usersDelete', label: 'Deactivate / delete users', group: 'Admin' },
  audit: { key: 'audit', label: 'View audit logs', group: 'Admin' },
  backup: { key: 'backup', label: 'Backup & restore database', group: 'Admin' },
} as const;

export type PermKey = keyof typeof PERMS;
export const ALL_PERM_KEYS = Object.keys(PERMS) as PermKey[];

export const ROLE_DEFAULTS: Record<Role, PermKey[]> = {
  developer: [...ALL_PERM_KEYS],
  admin: [
    'billing', 'verifyPayments', 'refunds', 'viewCost',
    'inventoryView', 'inventoryManage', 'stockAdjust', 'purchases',
    'excel', 'reports', 'transactions',
    'settings', 'usersView', 'usersManage', 'usersDelete', 'audit', 'backup',
  ],
  manager: [
    'billing', 'verifyPayments', 'refunds', 'viewCost',
    'inventoryView', 'inventoryManage', 'stockAdjust', 'purchases',
    'excel', 'reports', 'transactions', 'usersView', 'audit',
  ],
  cashier: ['billing', 'verifyPayments', 'inventoryView', 'transactions'],
};

/** resolve effective permissions = role defaults ⊕ per-user overrides */
export function effectivePerms(p: UserProfile): Record<PermKey, boolean> {
  const base = new Set(ROLE_DEFAULTS[p.role] ?? []);
  const out = {} as Record<PermKey, boolean>;
  for (const k of ALL_PERM_KEYS) {
    const o = p.permOverrides?.[k];
    out[k] = p.role === 'developer' ? true : o !== undefined ? o : base.has(k);
  }
  return out;
}

export function hasPerm(p: UserProfile | null, key: PermKey): boolean {
  if (!p || !p.active) return false;
  return effectivePerms(p)[key];
}
