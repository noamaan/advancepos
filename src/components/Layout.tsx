import { useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { useSettings } from '../store/settings';
import { useToast } from './ui';
import type { PermKey } from '../lib/permissions';

interface NavDef { to: string; icon: string; label: string; perm: PermKey; badge?: number }

function NavItemLink({ to, icon, label, badge }: NavDef) {
  return (
    <NavLink to={to} className={({ isActive }) => `nav-item ${isActive ? 'nav-active' : ''}`} end={to === '/'}>
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
      {badge ? <span className="nav-badge">{badge}</span> : null}
    </NavLink>
  );
}

export function Layout({ lowStockCount }: { lowStockCount: number }) {
  const { profile, logout, can, isDeveloper } = useAuth();
  const { settings } = useSettings();
  const toast = useToast();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<string>(() => {
    const t = localStorage.getItem('apos-theme') ?? 'dark';
    document.documentElement.dataset.theme = t;
    return t;
  });

  const items = useMemo<NavDef[]>(() => ([
    { to: '/', icon: '🧾', label: 'Billing / POS', perm: 'billing' },
    { to: '/inventory', icon: '📦', label: 'Inventory', perm: 'inventoryView', badge: lowStockCount },
    { to: '/purchases', icon: '🛒', label: 'Purchases', perm: 'purchases' },
    { to: '/transactions', icon: '💳', label: 'Transactions', perm: 'transactions' },
    { to: '/reports', icon: '📊', label: 'Reports', perm: 'reports' },
    { to: '/users', icon: '👥', label: 'Users', perm: 'usersView' },
    // 'billing' acts as "any staff" — every role reaches Settings for password change;
    // sensitive sections inside the page stay permission-gated.
    { to: '/settings', icon: '⚙️', label: 'Settings', perm: 'billing' },
  ]), [lowStockCount]);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('apos-theme', next);
  }

  async function doLogout() {
    await logout();
    toast('info', 'Signed out');
    nav('/login');
  }

  return (
    <div className={`app-shell ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">🍺</span>
          <div>
            <div className="brand-name">{settings.bizName}</div>
            <div className="brand-sub">AdvancePOS {isDeveloper && <span className="dev-pill">DEV</span>}</div>
          </div>
        </div>
        <nav className="nav">
          {items.filter((i) => can(i.perm)).map((i) => <NavItemLink key={i.to} {...i} />)}
        </nav>
        <div className="sidebar-foot">
          <button className="btn btn-ghost btn-block" onClick={toggleTheme}>{theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode'}</button>
          <div className="me">
            <div className="me-name">{profile?.name}</div>
            <div className="me-role">{profile?.role}</div>
          </div>
          <button className="btn btn-danger-ghost btn-block" onClick={doLogout}>Sign out</button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />
      <main className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon burger" onClick={() => setOpen(!open)} aria-label="Menu">☰</button>
          <div className="topbar-title">{settings.bizName}</div>
          <div className="topbar-user">{profile?.name} · <b>{profile?.role}</b></div>
        </header>
        <div className="page"><Outlet /></div>
      </main>
    </div>
  );
}
