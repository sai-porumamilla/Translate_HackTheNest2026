import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireSignIn, useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Meeting from './pages/Meeting.jsx';
import Summary from './pages/Summary.jsx';
import PastMeeting from './pages/PastMeeting.jsx';
import Call from './pages/Call.jsx';

// Page map (Figma "React revamp · pages"):
// /login → /dashboard → /meeting → /summary, and /dashboard → /meetings/:id. Guests can use /meeting directly.
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<RequireSignIn><Dashboard /></RequireSignIn>} />
        <Route path="/meeting" element={<Meeting />} />
        <Route path="/summary" element={<Summary />} />
        <Route path="/meetings/:id" element={<RequireSignIn><PastMeeting /></RequireSignIn>} />
        <Route path="/call/:code" element={<Call />} /> {/* teacher (signed in) or parent (link) */}
        <Route path="*" element={<Home />} />
      </Routes>
    </AuthProvider>
  );
}

function Home() {
  const { user } = useAuth();
  return <Navigate to={user ? '/dashboard' : '/login'} replace />;
}
