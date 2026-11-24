import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './styles.css';
import { AppProvider, useApp } from './lib/app';
import { Spinner, ToastProvider } from './components/ui';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Candidates } from './pages/Candidates';
import { CandidateForm } from './pages/CandidateForm';
import { CandidateProfile } from './pages/CandidateProfile';
import { UsersPage } from './pages/admin/Users';
import { SettingsPage } from './pages/admin/Settings';
import { AuditLog } from './pages/admin/AuditLog';
import { Mobility } from './pages/mobility/Mobility';
import { Bookings } from './pages/mobility/Bookings';
import { BookingDetail } from './pages/mobility/BookingDetail';
import { Pickups } from './pages/mobility/Pickups';
import { Accommodation } from './pages/accommodation/Accommodation';
import { Onboarding } from './pages/onboarding/Onboarding';
import { OnboardingSetup } from './pages/onboarding/Setup';
import { Medical } from './pages/onboarding/Medical';
import { Visa } from './pages/onboarding/Visa';
import { Training } from './pages/onboarding/Training';
import { Uniform } from './pages/onboarding/Uniform';
import { Employees } from './pages/onboarding/Employees';
import { Documents } from './pages/control/Documents';
import { Finance } from './pages/control/Finance';
import { Notifications } from './pages/control/Notifications';
import { Approvals } from './pages/control/Approvals';
import { Deployment } from './pages/control/Deployment';
import { Reports } from './pages/control/Reports';
import type { ReactNode } from 'react';

function Guard({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = useApp();
  return can(perm) ? <>{children}</> : <div className="py-20 text-center text-sm text-slate-500">You do not have access to this page.</div>;
}

function Root() {
  const { user, loading, can } = useApp();
  if (loading) return <Spinner label="Starting…" />;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={can('dashboard.view') ? <Dashboard /> : <Navigate to="/candidates" replace />} />
        <Route path="candidates" element={<Guard perm="candidates.view"><Candidates /></Guard>} />
        <Route path="candidates/new" element={<Guard perm="candidates.create"><CandidateForm /></Guard>} />
        <Route path="candidates/:id" element={<Guard perm="candidates.view"><CandidateProfile /></Guard>} />
        <Route path="candidates/:id/edit" element={<Guard perm="candidates.edit"><CandidateForm /></Guard>} />
        <Route path="mobility" element={<Guard perm="mobility.view"><Mobility /></Guard>} />
        <Route path="bookings" element={<Guard perm="mobility.view"><Bookings /></Guard>} />
        <Route path="bookings/:id" element={<Guard perm="mobility.view"><BookingDetail /></Guard>} />
        <Route path="pickups" element={<Guard perm="mobility.view"><Pickups /></Guard>} />
        <Route path="accommodation" element={<Guard perm="accommodation.view"><Accommodation /></Guard>} />
        <Route path="employees" element={<Guard perm="candidates.view"><Employees /></Guard>} />
        <Route path="onboarding" element={<Guard perm="onboarding.view"><Onboarding /></Guard>} />
        <Route path="onboarding/setup" element={<Guard perm="onboarding.templates"><OnboardingSetup /></Guard>} />
        <Route path="medical" element={<Guard perm="onboarding.view"><Medical /></Guard>} />
        <Route path="visa" element={<Guard perm="onboarding.view"><Visa /></Guard>} />
        <Route path="training" element={<Guard perm="onboarding.view"><Training /></Guard>} />
        <Route path="uniform" element={<Guard perm="onboarding.view"><Uniform /></Guard>} />
        <Route path="documents" element={<Guard perm="documents.view"><Documents /></Guard>} />
        <Route path="finance" element={<Guard perm="finance.view"><Finance /></Guard>} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="reports" element={<Reports />} />
        <Route path="deployment" element={<Guard perm="onboarding.view"><Deployment /></Guard>} />
        <Route path="admin/users" element={<Guard perm="users.manage"><UsersPage /></Guard>} />
        <Route path="admin/settings" element={<Guard perm="masters.manage"><SettingsPage /></Guard>} />
        <Route path="admin/audit" element={<Guard perm="audit.view"><AuditLog /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <ToastProvider><Root /></ToastProvider>
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);
