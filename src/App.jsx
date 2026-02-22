import { useState, useEffect } from 'react'
import HomePage from './components/HomePage'
import VouchForm from './components/VouchForm'
import NetworkForm from './components/NetworkForm'
import TalentPage from './components/TalentPage'
import AdminPage from './components/AdminPage'
import RolePage from './components/RolePage'
import RoleDetailPage from './components/RoleDetailPage'

export default function App() {
  const [page, setPage] = useState(() => {
    const path = window.location.pathname;
    if (path === '/vouch') return 'vouch';
    if (path === '/network') return 'network';
    if (path.startsWith('/talent/')) return 'talent';
    if (path === '/admin') return 'admin';
    if (path === '/role') return 'role';
    if (path.startsWith('/role/')) return 'roleDetail';
    return 'home';
  });

  useEffect(() => {
    const handlePop = () => {
      const path = window.location.pathname;
      if (path === '/vouch') setPage('vouch');
      else if (path === '/network') setPage('network');
      else if (path.startsWith('/talent/')) setPage('talent');
      else if (path === '/admin') setPage('admin');
      else if (path === '/role') setPage('role');
      else if (path.startsWith('/role/')) setPage('roleDetail');
      else setPage('home');
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  if (page === 'vouch') return <VouchForm />;
  if (page === 'network') return <NetworkForm />;
  if (page === 'talent') return <TalentPage />;
  if (page === 'admin') return <AdminPage />;
  if (page === 'role') return <RolePage />;
  if (page === 'roleDetail') return <RoleDetailPage />;
  return <HomePage />;
}
