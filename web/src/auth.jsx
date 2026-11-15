import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from './api.js';

const AuthContext = createContext(null);

// Who is signed in: { name } or null. Checked once with /api/me when the app loads.
export function AuthProvider({ children }) {
  const [teacher, setTeacher] = useState(undefined); // undefined = still checking
  useEffect(() => {
    api.me().then(setTeacher, () => setTeacher(null)); // 401 (or no backend yet) = not signed in
  }, []);
  if (teacher === undefined) return null;
  return <AuthContext.Provider value={{ teacher, setTeacher }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export function RequireTeacher({ children }) {
  const { teacher } = useAuth();
  return teacher ? children : <Navigate to="/login" replace />;
}
