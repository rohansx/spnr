import { Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import Advertiser from './pages/Advertiser';
import Login from './pages/Login';
import { RequireAuth } from './components/RequireAuth';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route path="/advertiser" element={<Advertiser />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
