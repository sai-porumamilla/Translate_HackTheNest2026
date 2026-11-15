import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireTeacher, useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Meeting from './pages/Meeting.jsx';
import Summary from './pages/Summary.jsx';
import PastMeeting from './pages/PastMeeting.jsx';

// Page map (Figma "React revamp · pages"):
// /login → /dashboard → /meeting → /summary, and /dashboard → /meetings/:id. Guests can use /meeting directly.
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<RequireTeacher><Dashboard /></RequireTeacher>} />
        <Route path="/meeting" element={<Meeting />} />
        <Route path="/summary" element={<Summary />} />
        <Route path="/meetings/:id" element={<RequireTeacher><PastMeeting /></RequireTeacher>} />
        <Route path="*" element={<Home />} />
      </Routes>
    </AuthProvider>
  );
}

function Home() {
  const { teacher } = useAuth();
  return <Navigate to={teacher ? '/dashboard' : '/login'} replace />;
}
