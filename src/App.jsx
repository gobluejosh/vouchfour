import { useState, useEffect } from 'react'
import HomePage from './components/HomePage'
import VouchForm from './components/VouchForm'
import AdminPage from './components/AdminPage'
import StartVouchPage from './components/StartVouchPage'
import NetworkBrainPage from './components/NetworkBrainPage'
import PersonPage from './components/PersonPage'
import EnrichmentReviewPage from './components/EnrichmentReviewPage'
import InvitePage from './components/InvitePage'
import ThreadPage from './components/ThreadPage'

// ── Global client-side error reporting ──────────────────────────────
function reportError(message, stack, context) {
  try {
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        message,
        stack,
        context,
        url: window.location.href,
        userAgent: navigator.userAgent,
      }),
    }).catch(() => {}) // silently fail
  } catch {}
}

window.addEventListener('error', (e) => {
  reportError(e.message, e.error?.stack, 'window.onerror')
})

window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || String(e.reason)
  reportError(msg, e.reason?.stack, 'unhandledrejection')
})

export default function App() {
  const [page, setPage] = useState(() => {
    const path = window.location.pathname;
    if (path === '/vouch') return 'vouch';
    if (path.startsWith('/talent/')) {
      window.location.replace('/brain' + window.location.search);
      return 'home'; // placeholder while redirecting
    }
    if (path === '/admin/review') return 'adminReview';
    if (path === '/admin') return 'admin';
    if (path === '/start-vouch') return 'startVouch';
    if (path === '/brain') return 'brain';
    if (path.startsWith('/person/')) return 'person';
    if (path.startsWith('/invite/')) return 'invite';
    if (path.startsWith('/thread/')) return 'thread';
    return 'home';
  });

  useEffect(() => {
    const handlePop = () => {
      const path = window.location.pathname;
      if (path === '/vouch') setPage('vouch');
      else if (path.startsWith('/talent/')) {
        window.location.replace('/brain' + window.location.search);
        return;
      }
      else if (path === '/admin/review') setPage('adminReview');
      else if (path === '/admin') setPage('admin');
      else if (path === '/start-vouch') setPage('startVouch');
      else if (path === '/brain') setPage('brain');
      else if (path.startsWith('/person/')) setPage('person');
      else if (path.startsWith('/invite/')) setPage('invite');
      else if (path.startsWith('/thread/')) setPage('thread');
      else setPage('home');
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  if (page === 'vouch') return <VouchForm />;
  if (page === 'adminReview') return <EnrichmentReviewPage />;
  if (page === 'admin') return <AdminPage />;
  if (page === 'startVouch') return <StartVouchPage />;
  if (page === 'brain') return <NetworkBrainPage />;
  if (page === 'person') return <PersonPage />;
  if (page === 'invite') return <InvitePage />;
  if (page === 'thread') return <ThreadPage />;
  return <HomePage />;
}
