import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import RequireAuth from './components/RequireAuth';
import Home from './pages/Home';
import Join from './pages/Join';
import NewRoom from './pages/NewRoom';
import Room from './pages/Room';
import Rooms from './pages/Rooms';
import SignIn from './pages/SignIn';
import { SessionProvider } from './session';

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/sign-in" element={<SignIn />} />
          {/* /join handles being signed out itself: it has to catch the invite code before any redirect */}
          <Route path="/join" element={<Join />} />
          <Route path="/rooms" element={<RequireAuth><Rooms /></RequireAuth>} />
          <Route path="/rooms/new" element={<RequireAuth><NewRoom /></RequireAuth>} />
          <Route path="/rooms/:id" element={<RequireAuth><Room /></RequireAuth>} />
          {/* any address we don't know goes home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}
