import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Cloud, LogOut, UserRound } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { getActiveDocument, getSavedDocuments } from '../lib/documents';
import { getDisplayName, isHistorySyncEnabled, recordOptimization, setHistorySyncEnabled, updateDisplayName } from '../lib/cloudHistory';
import { supabase } from '../lib/supabase';

export const AccountPage: React.FC = () => {
  const { configured, loading: authLoading, user, signOut } = useAuth();
  const [formMode, setFormMode] = useState<'signin'|'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [syncEnabled, setSyncEnabled] = useState(()=>user ? isHistorySyncEnabled(user.id) : false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setSyncEnabled(user ? isHistorySyncEnabled(user.id) : false);
    if (user) void getDisplayName().then(name => { if (alive && name) setDisplayName(name); }).catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Could not load your profile.'); });
    return () => { alive = false; };
  }, [user?.id]);

  const submitAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setError(''); setMessage('');
    try {
      if (formMode === 'signup') {
        const name = displayName.trim();
        if (name.length < 1 || name.length > 100) throw new Error('Display name must be between 1 and 100 characters.');
        const { data, error: authError } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { display_name: name } } });
        if (authError) throw authError;
        setMessage(data.session ? 'Your account is ready.' : 'Check your email to confirm your account, then sign in.');
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
        setMessage('Signed in successfully.');
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Authentication failed.'); }
    finally { setBusy(false); }
  };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { await updateDisplayName(displayName); setMessage('Profile updated.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update your profile.'); }
    finally { setBusy(false); }
  };

  const updateSyncPreference = (enabled: boolean) => {
    try { if (!user) throw new Error('Sign in before changing this preference.'); setHistorySyncEnabled(enabled, user.id); setSyncEnabled(enabled); setError(''); setMessage(enabled ? 'Future conversions will sync while you are signed in.' : 'Cloud history sync is off. Existing cloud history is unchanged.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save this setting.'); }
  };

  const syncLocalDocuments = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      if (!user) throw new Error('Sign in before syncing local documents.');
      setHistorySyncEnabled(true,user.id); setSyncEnabled(true);
      const [saved, active] = await Promise.all([getSavedDocuments(), getActiveDocument()]);
      const unique = new Map(saved.map(doc => [doc.id, doc]));
      if (active) unique.set(active.id, active);
      const results = await Promise.allSettled(Array.from(unique.values(), recordOptimization));
      const failed = results.filter(result => result.status === 'rejected');
      if (failed.length) throw new Error(`${results.length - failed.length} of ${results.length} documents synced; ${failed.length} could not be synced. Check the database migration and try again.`);
      setMessage(`${results.length} local document${results.length === 1 ? '' : 's'} synced to your account.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not sync local documents.'); }
    finally { setBusy(false); }
  };

  const leaveAccount = async () => { setBusy(true); setError(''); setMessage(''); try { await signOut(); setMessage('Signed out.'); } catch (e) { setError(e instanceof Error ? e.message : 'Could not sign out.'); } finally { setBusy(false); } };

  return <div className="relative z-10 min-h-screen pt-32 sm:pt-36 pb-24 px-4 sm:px-8 max-w-3xl mx-auto select-text">
    <div className="mb-10"><div className="mb-3"><span className="font-technical text-[11px] uppercase tracking-[0.22em] text-[#7b7b7b]">BYTELESS ACCOUNT</span></div><h1 className="font-editorial text-4xl sm:text-5xl text-[#111111] tracking-tight">Account</h1><p className="mt-2 text-sm text-[#7b7b7b]">Sign in to keep an account history across devices. Local conversion and offline reading remain available without an account.</p></div>
    {!configured ? <section className="rounded-2xl border border-neutral-300/80 bg-white/70 p-6 sm:p-8"><h2 className="font-editorial text-2xl">Supabase is not configured</h2><p className="mt-3 text-sm text-[#7b7b7b]">Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> in your local environment, apply the SQL migration, and restart the frontend.</p></section> : authLoading ? <p role="status" className="text-sm text-[#7b7b7b]">Checking your session…</p> : user ? <div className="space-y-5">
      <section className="rounded-2xl border border-neutral-300/80 bg-white/70 p-6 sm:p-8"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-neutral-200/70 flex items-center justify-center"><UserRound className="w-5 h-5"/></div><div><h2 className="font-editorial text-2xl">Signed in</h2><p className="text-xs text-neutral-500">{user.email}</p></div><button onClick={()=>void leaveAccount()} disabled={busy} className="ml-auto inline-flex items-center gap-2 rounded-full border border-neutral-300 px-3 py-2 text-xs disabled:opacity-50"><LogOut className="w-3.5 h-3.5"/>Sign out</button></div>
        <form onSubmit={saveProfile} className="mt-6 border-t border-neutral-200 pt-5"><label htmlFor="profile-name" className="block text-xs text-neutral-600">Display name</label><div className="mt-2 flex gap-2"><input id="profile-name" value={displayName} maxLength={100} onChange={e=>setDisplayName(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"/><button disabled={busy} className="rounded-full bg-[#0d0d0d] px-4 py-2 text-xs text-white disabled:opacity-50">Save profile</button></div></form>
      </section>
      <section className="rounded-2xl border border-neutral-300/80 bg-white/70 p-6 sm:p-8"><div className="flex items-start gap-3"><Cloud className="mt-0.5 w-4 h-4 text-neutral-600"/><div className="flex-1"><h2 className="font-editorial text-2xl">Conversion history</h2><p className="mt-2 text-sm text-[#7b7b7b]">When enabled, future converted HTML/text and measured metadata sync to your private account history. Original uploaded file contents are not uploaded; only the filename, type, and byte counts are stored for uploaded HTML/PDFs.</p><label className="mt-4 flex items-start gap-3 text-sm"><input type="checkbox" checked={syncEnabled} onChange={e=>updateSyncPreference(e.target.checked)} className="mt-1 accent-neutral-900"/><span>Sync future conversions to this account</span></label><button onClick={()=>void syncLocalDocuments()} disabled={busy} className="mt-4 rounded-full border border-neutral-300 bg-white px-4 py-2 text-xs disabled:opacity-50">Sync local documents now</button><p className="mt-3 text-[11px] text-neutral-500">Cloud history is separate from Saved Content in IndexedDB. You can view or delete cloud entries on the Saved page. Row Level Security restricts database rows to this account.</p></div></div></section>
    </div> : <section className="rounded-2xl border border-neutral-300/80 bg-white/70 p-6 sm:p-8"><div className="mb-5 flex gap-2"><button onClick={()=>{setFormMode('signin');setMessage('');setError('');}} className={`rounded-full px-4 py-2 text-xs ${formMode==='signin'?'bg-[#0d0d0d] text-white':'border border-neutral-300'}`}>Sign in</button><button onClick={()=>{setFormMode('signup');setMessage('');setError('');}} className={`rounded-full px-4 py-2 text-xs ${formMode==='signup'?'bg-[#0d0d0d] text-white':'border border-neutral-300'}`}>Create account</button></div>
      <form onSubmit={submitAuth} className="space-y-3">{formMode==='signup'&&<label className="block text-xs text-neutral-600">Display name<input required maxLength={100} value={displayName} onChange={e=>setDisplayName(e.target.value)} className="mt-1 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm"/></label>}<label className="block text-xs text-neutral-600">Email<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm"/></label><label className="block text-xs text-neutral-600">Password<input required type="password" minLength={6} autoComplete={formMode==='signup'?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} className="mt-1 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm"/></label><button disabled={busy} className="inline-flex items-center gap-2 rounded-full bg-[#0d0d0d] px-5 py-2.5 text-xs text-white disabled:opacity-50">{busy?'Please wait…':formMode==='signup'?'Create account':'Sign in'}<ArrowRight className="w-3.5 h-3.5"/></button></form><p className="mt-4 text-[11px] text-[#7b7b7b]">Email confirmation may be required based on your Supabase Auth settings. Account creation does not upload existing documents unless you request a sync.</p>
    </section>}
    {error&&<p role="alert" className="mt-4 text-sm text-amber-800">{error}</p>}{message&&<p role="status" aria-live="polite" className="mt-4 text-sm text-[#6b6b6b]">{message}</p>}
    <footer className="mt-16 pt-6 border-t border-neutral-200 flex items-center justify-between text-xs text-[#7b7b7b]"><span>ACCOUNT · PRIVATE CLOUD HISTORY</span><Link to="/saved" className="underline">Saved Content</Link></footer>
  </div>;
};

