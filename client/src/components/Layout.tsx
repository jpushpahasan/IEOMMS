import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BedDouble, Car, ClipboardList, FileBarChart, FolderOpen, Inbox, Rocket, Wallet, Globe2, GraduationCap, IdCard, ListChecks, Shirt, Stethoscope, UsersRound, KeyRound, LayoutDashboard, LogOut, Menu, Plane, Settings, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
import { useApp } from '../lib/app';
import { initials } from '../lib/format';
import { cx } from './ui';
import { ChangePasswordModal } from '../pages/ChangePassword';
import { NotificationBell } from '../pages/control/Notifications';

type Item = { to: string; label: string; icon: ReactNode; perm?: string; end?: boolean };
const SECTIONS: { title?: string; items: Item[] }[] = [
  { items: [
    { to: '/', label: 'Dashboard', icon: <LayoutDashboard className="size-4" />, perm: 'dashboard.view', end: true },
    { to: '/candidates', label: 'Candidates', icon: <Users className="size-4" />, perm: 'candidates.view' },
    { to: '/employees', label: 'Employee Master', icon: <UsersRound className="size-4" />, perm: 'candidates.view' },
  ] },
  { title: 'Mobilisation', items: [
    { to: '/mobility', label: 'International Mobility', icon: <Globe2 className="size-4" />, perm: 'mobility.view' },
    { to: '/bookings', label: 'Flight Bookings', icon: <Plane className="size-4" />, perm: 'mobility.view' },
    { to: '/pickups', label: 'Airport Pickup', icon: <Car className="size-4" />, perm: 'mobility.view' },
    { to: '/accommodation', label: 'Accommodation', icon: <BedDouble className="size-4" />, perm: 'accommodation.view' },
  ] },
  { title: 'Onboarding', items: [
    { to: '/onboarding', label: 'Onboarding Activities', icon: <ListChecks className="size-4" />, perm: 'onboarding.view' },
    { to: '/medical', label: 'Medical', icon: <Stethoscope className="size-4" />, perm: 'onboarding.view' },
    { to: '/training', label: 'Training', icon: <GraduationCap className="size-4" />, perm: 'onboarding.view' },
    { to: '/visa', label: 'Visa & Immigration', icon: <IdCard className="size-4" />, perm: 'onboarding.view' },
    { to: '/uniform', label: 'Uniform & PPE', icon: <Shirt className="size-4" />, perm: 'onboarding.view' },
    { to: '/deployment', label: 'Clearance & Deployment', icon: <Rocket className="size-4" />, perm: 'onboarding.view' },
  ] },
  { title: 'Control', items: [
    { to: '/approvals', label: 'Approvals', icon: <Inbox className="size-4" /> },
    { to: '/documents', label: 'Document Management', icon: <FolderOpen className="size-4" />, perm: 'documents.view' },
    { to: '/finance', label: 'Financial Tracking', icon: <Wallet className="size-4" />, perm: 'finance.view' },
    { to: '/reports', label: 'Reports', icon: <FileBarChart className="size-4" /> },
  ] },
  { title: 'Administration', items: [
    { to: '/admin/users', label: 'User Management', icon: <ShieldCheck className="size-4" />, perm: 'users.manage' },
    { to: '/admin/settings', label: 'Settings', icon: <Settings className="size-4" />, perm: 'masters.manage' },
    { to: '/admin/audit', label: 'Audit Log', icon: <ClipboardList className="size-4" />, perm: 'audit.view' },
  ] },
];

export function Layout() {
  const { user, company, can, logout } = useApp();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => setOpen(false), [loc.pathname]);
  if (!user) return null;

  const sidebar = (
    <div className="flex h-full flex-col bg-navy-900 text-slate-300">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="grid size-9 place-items-center rounded-lg bg-white/10">
          <svg viewBox="0 0 32 32" className="size-6"><path d="M9 22l7-12 7 12" stroke="#14b8a6" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold tracking-wide text-white">IEOMMS</div>
          <div className="truncate text-[11px] text-slate-400">Onboarding & Mobility</div>
        </div>
      </div>
      <nav className="scroll-thin flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {SECTIONS.map((s, i) => {
          const items = s.items.filter((it) => !it.perm || can(it.perm));
          if (!items.length) return null;
          return (
            <div key={i}>
              {s.title && <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{s.title}</div>}
              <div className="space-y-0.5">
                {items.map((it) => (
                  <NavLink key={it.to} to={it.to} end={it.end}
                    className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      isActive ? 'bg-white/10 text-white shadow-[inset_3px_0_0_#14b8a6]' : 'hover:bg-white/5 hover:text-white')}>
                    {it.icon}{it.label}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/10 px-5 py-3 text-[11px] text-slate-500">{company}</div>
    </div>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <aside className="relative h-full w-64">{sidebar}
            <button className="absolute top-4 right-3 rounded p-1 text-slate-300 hover:bg-white/10" onClick={() => setOpen(false)} aria-label="Close menu"><X className="size-5" /></button>
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="size-5" /></button>
          <div className="flex-1" />
          {can('candidates.create') && (
            <button onClick={() => nav('/candidates/new')} className="hidden items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 sm:inline-flex">
              <UserPlus className="size-4" />New candidate
            </button>
          )}
          <NotificationBell />
          <UserMenu onPassword={() => setPwOpen(true)} onLogout={logout} name={user.full_name} role={user.role_name} />
        </header>
        <main className="scroll-thin flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8"><Outlet /></main>
      </div>
      <ChangePasswordModal open={pwOpen || user.must_change_password} forced={user.must_change_password} onClose={() => setPwOpen(false)} />
    </div>
  );
}

function UserMenu({ name, role, onPassword, onLogout }: { name: string; role: string; onPassword: () => void; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-slate-100">
        <span className="grid size-8 place-items-center rounded-full bg-navy-800 text-xs font-semibold text-white">{initials(name)}</span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm leading-tight font-medium text-slate-800">{name}</span>
          <span className="block text-[11px] leading-tight text-slate-500">{role}</span>
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
            <button onClick={() => { setOpen(false); onPassword(); }} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><KeyRound className="size-4" />Change password</button>
            <button onClick={onLogout} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"><LogOut className="size-4" />Sign out</button>
          </div>
        </>
      )}
    </div>
  );
}
