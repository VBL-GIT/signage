import { applyTheme, getTheme, type ThemePref } from '../lib/theme';
import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { useAuth, useHasPrivilege } from '../store/auth';
import { ROLE_LABELS } from '../types';
import { Button } from './ui';
import { getPasswordRequestCount } from '../api';

export function Layout() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const [theme, setTheme] = useState<ThemePref>(getTheme());
  const refreshPrivileges = useAuth((s) => s.refreshPrivileges);
  const has = useHasPrivilege();
  const navigate = useNavigate();

  // Pick up custom-role privilege changes without forcing a re-login.
  useEffect(() => { refreshPrivileges(); }, []);

  const canHandlePasswords = user?.role === 'rjcorp_admin' || user?.role === 'vendor_admin';
  const [pendingPw, setPendingPw] = useState(0);
  useEffect(() => {
    if (!canHandlePasswords) return;
    const load = () => getPasswordRequestCount().then(setPendingPw).catch(() => undefined);
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [canHandlePasswords]);

  if (!user) return <Navigate to="/login" replace />;

  if (user.role === 'employee') {
    return (
      <div className="center-screen">
        <div className="card" style={{ maxWidth: 420, textAlign: 'center' }}>
          <h2>Use the mobile app</h2>
          <p className="meta">Field employees work from the Signage mobile app. This web console is for RJCorp and vendor teams.</p>
          <Button variant="secondary" onClick={async () => { await logout(); navigate('/login'); }}>Log out</Button>
        </div>
      </div>
    );
  }

  const isRjcorp = user.role === 'rjcorp_admin' || user.role === 'rjcorp_user';
  const showApprovals = has('task.approve');
  const showAssignments = has('task.assign');
  const showStores = isRjcorp && (has('task.create') || has('store.manage'));
  const showOnboarding = has('vendor.manage') || has('store.manage') || has('user.manage') || has('task.create');
  const showBulk = has('user.manage') || has('store.manage') || has('task.create') || has('vendor.manage');
  const showManage = has('user.status') || has('vendor.status') || has('role.manage');

  const link = (to: string, label: string) => (
    <NavLink to={to} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>
  );

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="logo">Signage{isRjcorp ? ' · RJCorp' : ' · Vendor'}</div>
        {link('/tasks', 'Tasks')}
        {showOnboarding && link('/onboarding', 'Onboarding')}
        {showBulk && link('/bulk', 'Bulk Upload')}
        {showStores && link('/stores', 'Stores')}
        {showAssignments && link('/assignments', 'Bulk Assignment')}
        {showApprovals && link('/approvals', 'Approvals')}
        {link('/reports', 'Activity Report')}
        {showManage && link('/manage', 'Manage')}
        {canHandlePasswords && link('/password-requests', pendingPw ? `Password requests (${pendingPw})` : 'Password requests')}
        {isRjcorp && link('/images', 'Images')}
        {user.role === 'rjcorp_admin' && link('/access', 'Roles & Permissions')}
        {user.role === 'rjcorp_admin' && link('/audit', 'Audit Log')}
        <div className="spacer" />
        <div className="who">{user.name}<br /><span className="muted" style={{ wordBreak: 'break-all' }}>{user.email}</span><br /><span className="muted">{ROLE_LABELS[user.role]}</span></div>
        <div className="theme-switch">
          {(['system', 'light', 'dark'] as ThemePref[]).map((t) => (
            <button key={t} className={theme === t ? 'on' : ''} onClick={() => { applyTheme(t); setTheme(t); }}>
              {t === 'system' ? 'Auto' : t === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={async () => { await logout(); navigate('/login'); }}>Log out</Button>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
