import { useState } from 'react';
import { Lock, User } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useApp } from '../lib/app';
import { Alert, Button } from '../components/ui';

export function Login() {
  const { refresh } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/login', { username, password });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server.');
    } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-navy-900 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute -top-32 -right-32 size-[28rem] rounded-full bg-brand-500/10" />
        <div className="absolute -bottom-40 -left-20 size-[32rem] rounded-full bg-white/5" />
        <div className="relative flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-white/10">
            <svg viewBox="0 0 32 32" className="size-7"><path d="M9 22l7-12 7 12" stroke="#14b8a6" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <span className="text-lg font-bold tracking-wide text-white">IEOMMS</span>
        </div>
        <div className="relative max-w-lg">
          <h1 className="text-4xl leading-tight font-semibold text-white">International Employee Onboarding & Mobility</h1>
          <p className="mt-4 text-base text-slate-300">One control centre for every selected candidate — from selection and travel to arrival, accommodation, medical, visa, training and deployment in the UAE.</p>
        </div>
        <div className="relative text-xs text-slate-500">Authorised personnel only. All activity is recorded.</div>
      </div>
      <div className="flex items-center justify-center bg-white p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Sign in</h2>
            <p className="mt-1 text-sm text-slate-500">Use your company account to continue.</p>
          </div>
          {error && <Alert tone="error">{error}</Alert>}
          <label className="block">
            <span className="label">Username</span>
            <div className="relative"><User className="absolute top-2.5 left-3 size-4 text-slate-400" />
              <input className="input pl-9" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} required /></div>
          </label>
          <label className="block">
            <span className="label">Password</span>
            <div className="relative"><Lock className="absolute top-2.5 left-3 size-4 text-slate-400" />
              <input type="password" className="input pl-9" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          </label>
          <Button type="submit" loading={busy} className="w-full py-2.5">Sign in</Button>
        </form>
      </div>
    </div>
  );
}
