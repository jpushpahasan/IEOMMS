import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useApp } from '../lib/app';
import { Alert, Button, Field, Modal, useToast } from '../components/ui';

export function ChangePasswordModal({ open, forced, onClose }: { open: boolean; forced: boolean; onClose: () => void }) {
  const { refresh, logout } = useApp();
  const toast = useToast();
  const [f, setF] = useState({ current: '', password: '', confirm: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (f.password !== f.confirm) return setErr({ confirm: 'Passwords do not match.' });
    setBusy(true);
    setErr({});
    try {
      await api.post('/auth/password', { current: f.current, password: f.password });
      toast('success', 'Password changed.');
      setF({ current: '', password: '', confirm: '' });
      await refresh();
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setErr(e.details || { _: e.message });
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={forced ? () => {} : onClose} title={forced ? 'Set a new password' : 'Change password'} size="sm"
      footer={<>
        {forced ? <Button variant="ghost" onClick={logout}>Sign out</Button> : <Button variant="secondary" onClick={onClose}>Cancel</Button>}
        <Button onClick={submit} loading={busy}>Save password</Button>
      </>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {forced && <Alert tone="info">For security, please replace the temporary password before continuing.</Alert>}
        {err._ && <Alert tone="error">{err._}</Alert>}
        <Field label="Current password" error={err.current}><input type="password" autoComplete="current-password" className="input" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
        <Field label="New password" error={err.password} hint="At least 10 characters with upper-case, lower-case and a number.">
          <input type="password" autoComplete="new-password" className="input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
        <Field label="Confirm new password" error={err.confirm}><input type="password" autoComplete="new-password" className="input" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
