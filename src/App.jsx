import { useState, useEffect } from 'react'
import HomePage from './components/HomePage'
import VouchForm from './components/VouchForm'
import NetworkForm from './components/NetworkForm'
import TalentPage from './components/TalentPage'
import AdminPage from './components/AdminPage'

export default function App() {
  const [page, setPage] = useState(() => {
    const path = window.location.pathname;
    if (path === '/vouch') return 'vouch';
    if (path === '/network') return 'network';
    if (path.startsWith('/talent/')) return 'talent';
    if (path === '/admin') return 'admin';
    return 'home';
  });

  useEffect(() => {
    const handlePop = () => {
      const path = window.location.pathname;
      if (path === '/vouch') setPage('vouch');
      else if (path === '/network') setPage('network');
      else if (path.startsWith('/talent/')) setPage('talent');
      else if (path === '/admin') setPage('admin');
      else setPage('home');
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  if (page === 'vouch') return <VouchForm />;
  if (page === 'network') return <NetworkForm />;
  if (page === 'talent') return <TalentPage />;
  if (page === 'admin') return <AdminPage />;
  return <HomePage />;
}
