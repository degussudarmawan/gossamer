import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import Home from './pages/Home';
import SignIn from './pages/SignIn';
import { SessionProvider } from './session';

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/sign-in" element={<SignIn />} />
          {/* any address we don't know goes home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}
