import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { teacher, setTeacher } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (teacher) return <Navigate to="/dashboard" replace />;

  async function submit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      setTeacher(await api.login(form.get('email'), form.get('password')));
      navigate('/dashboard');
    } catch (err) {
      setError(
        err.status === 401 ? 'Courriel ou mot de passe incorrect · Wrong email or password'
        // 404/405 = this backend has no /api/login route yet: point people at the guest path instead of a raw code
        : err.status === 404 || err.status === 405 ? 'Connexion pas encore disponible · Sign-in isn’t available yet. Continue without an account below.'
        : err.message,
      );
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="card page" onSubmit={submit}>
        <h1>ParentBridge</h1>
        <p className="sub"><span lang="fr">Espace enseignant</span> · Teacher sign-in</p>
        <label htmlFor="email"><span lang="fr">Courriel</span> · Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
        <label htmlFor="password"><span lang="fr">Mot de passe</span> · Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        <button className="btn primary" type="submit" disabled={busy}><span lang="fr">Se connecter</span> · Sign in</button>
        <p className="form-error" role="alert">{error}</p>
        <Link className="guest" to="/meeting"><span lang="fr">Continuer sans compte</span> · Continue without an account</Link>
      </form>
    </main>
  );
}
