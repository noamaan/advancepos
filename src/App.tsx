import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useMemo, type ReactNode } from 'react';
import { where } from 'firebase/firestore';
import { firebaseReady } from './lib/firebase';
import { AuthProvider, useAuth } from './store/auth';
import { SettingsProvider, useSettings } from './store/settings';
import { ToastProvider, Spinner } from './components/ui';
import { Layout } from './components/Layout';
import { useCollection } from './hooks/fs';
import { Setup } from './pages/Setup';
import { Login } from './pages/Login';
import { POS } from './pages/POS';
import { Inventory } from './pages/Inventory';
import { Purchases } from './pages/Purchases';
import { Transactions } from './pages/Transactions';
import { Reports } from './pages/Reports';
import { Users } from './pages/Users';
import { SettingsPage } from './pages/Settings';
import type { PermKey } from './lib/permissions';
import type { Product } from './types';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, profile, loading, noProfile, logout } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner label="Loading…" />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (noProfile) {
    return (
      <div className="setup-wrap"><div className="card setup-card">
        <h2>No access profile</h2>
        <p>This login exists, but it has no staff profile in the database. Ask an <b>admin</b> to add you from <i>Users</i>.<br />
        Setting up the very first developer account? Follow <b>README.md → §3 First developer bootstrap</b>.</p>
        <button className="btn" onClick={() => void logout()}>Sign out</button>
      </div></div>
    );
  }
  if (profile && !profile.active) {
    return (
      <div className="setup-wrap"><div className="card setup-card">
        <h2>Account deactivated</h2>
        <p>Your account has been deactivated. Contact the shop administrator.</p>
        <button className="btn" onClick={() => void logout()}>Sign out</button>
      </div></div>
    );
  }
  return <>{children}</>;
}

function RequirePerm({ perm, children }: { perm: PermKey; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(perm)) return <div className="card pad"><h3>🔒 Not permitted</h3><p className="muted">Your role doesn't include this area. Ask an admin to grant it.</p></div>;
  return <>{children}</>;
}

function Shell() {
  const [products] = useCollection<Product>('products', [where('active', '==', true)]);
  const { settings } = useSettings();
  const lowCount = useMemo(
    () => products.filter((p) => p.active !== false && p.stockQty <= (p.lowStockThreshold ?? settings.lowStockDefault)).length,
    [products, settings.lowStockDefault],
  );
  return <Layout lowStockCount={lowCount} />;
}

export default function App() {
  if (!firebaseReady) return <Setup />;
  return (
    <ToastProvider>
      <AuthProvider>
        <SettingsProvider>
          <HashRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<RequireAuth><Shell /></RequireAuth>}>
                <Route index element={<RequirePerm perm="billing"><POS /></RequirePerm>} />
                <Route path="inventory" element={<RequirePerm perm="inventoryView"><Inventory /></RequirePerm>} />
                <Route path="purchases" element={<RequirePerm perm="purchases"><Purchases /></RequirePerm>} />
                <Route path="transactions" element={<RequirePerm perm="transactions"><Transactions /></RequirePerm>} />
                <Route path="reports" element={<RequirePerm perm="reports"><Reports /></RequirePerm>} />
                <Route path="users" element={<RequirePerm perm="usersView"><Users /></RequirePerm>} />
                <Route path="settings" element={<RequirePerm perm="billing"><SettingsPage /></RequirePerm>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </HashRouter>
        </SettingsProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
