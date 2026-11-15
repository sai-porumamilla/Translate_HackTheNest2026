import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from './api.js';

const AuthContext = createContext(null);

// Who is signed in: { name, role: 'teacher' | 'parent' } or null. Checked once with /api/me when the app loads.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = still checking
  useEffect(() => {
    api.me().then(setUser, () => setUser(null)); // 401 (or no backend yet) = not signed in
  }, []);
  if (user === undefined) return null;
  return <AuthContext.Provider value={{ user, setUser }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export function RequireSignIn({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}
