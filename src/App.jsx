import { useState, useEffect } from 'react'
import HomePage from './components/HomePage'
import VouchForm from './components/VouchForm'
import TalentPage from './components/TalentPage'
import AdminPage from './components/AdminPage'
import StartVouchPage from './components/StartVouchPage'
import NetworkBrainPage from './components/NetworkBrainPage'
import PersonPage from './components/PersonPage'
import EnrichmentReviewPage from './components/EnrichmentReviewPage'

export default function App() {
  const [page, setPage] = useState(() => {
    const path = window.location.pathname;
    if (path === '/vouch') return 'vouch';
    if (path.startsWith('/talent/')) return 'talent';
    if (path === '/admin/review') return 'adminReview';
    if (path === '/admin') return 'admin';
    if (path === '/start-vouch') return 'startVouch';
    if (path === '/brain') return 'brain';
    if (path.startsWith('/person/')) return 'person';
    return 'home';
  });

  useEffect(() => {
    const handlePop = () => {
      const path = window.location.pathname;
      if (path === '/vouch') setPage('vouch');
      else if (path.startsWith('/talent/')) setPage('talent');
      else if (path === '/admin/review') setPage('adminReview');
      else if (path === '/admin') setPage('admin');
      else if (path === '/start-vouch') setPage('startVouch');
      else if (path === '/brain') setPage('brain');
      else if (path.startsWith('/person/')) setPage('person');
      else setPage('home');
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  if (page === 'vouch') return <VouchForm />;
  if (page === 'talent') return <TalentPage />;
  if (page === 'adminReview') return <EnrichmentReviewPage />;
  if (page === 'admin') return <AdminPage />;
  if (page === 'startVouch') return <StartVouchPage />;
  if (page === 'brain') return <NetworkBrainPage />;
  if (page === 'person') return <PersonPage />;
  return <HomePage />;
}
