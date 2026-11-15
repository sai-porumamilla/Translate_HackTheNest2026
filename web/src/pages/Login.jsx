import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Bi } from '../lang.jsx';

export default function Login() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (user) return <Navigate to="/dashboard" replace />;

  async function submit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      setUser(await api.login(form.get('email'), form.get('password')));
      navigate('/dashboard');
    } catch (err) {
      setError(
        err.status === 401 ? 'Courriel ou mot de passe incorrect · Wrong email or password'
        // 404/405 = this backend has no /api/login route yet: point people at the guest path instead of a raw code
        : err.status === 404 || err.status === 405 ? 'Connexion pas encore disponible · Sign-in isn’t available yet'
        : err.message,
      );
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="card page" onSubmit={submit}>
        <h1>ParentBridge</h1>
        <p className="sub"><Bi fr="Rencontres parents-enseignants" en="Parent–teacher meetings" /></p>
        <label htmlFor="email"><Bi fr="Courriel" en="Email" /></label>
        <input id="email" name="email" type="email" autoComplete="username" required />
        <label htmlFor="password"><Bi fr="Mot de passe" en="Password" /></label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        <button className="btn primary" type="submit" disabled={busy}><Bi fr="Se connecter" en="Sign in" /></button>
        <p className="form-error" role="alert">{error && <Bi text={error} />}</p>
        <Link className="guest" to="/meeting"><Bi fr="Continuer sans compte" en="Continue without an account" /></Link>
      </form>
    </main>
  );
}
