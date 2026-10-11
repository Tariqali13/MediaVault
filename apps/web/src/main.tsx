import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import '@fontsource/schibsted-grotesk/400';
import '@fontsource/schibsted-grotesk/500';
import '@fontsource/schibsted-grotesk/600';
import '@fontsource/schibsted-grotesk/700';
import '@fontsource/schibsted-grotesk/800';
import './styles.css';
import { ApiError } from './lib/api';
import { AppShell } from './components/AppShell';
import { Welcome } from './pages/Welcome';
import { Library } from './pages/Library';
import { Collections } from './pages/Collections';
import { SharedLinks } from './pages/SharedLinks';
import { People } from './pages/People';
import { Activity } from './pages/Activity';
import { PublicShare } from './pages/PublicShare';
import { AcceptInvite } from './pages/AcceptInvite';
import { WarmUpGate } from './components/WarmUpGate';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

const router = createBrowserRouter([
  { path: '/welcome', element: <Welcome /> },
  { path: '/s/:token', element: <PublicShare /> },
  { path: '/invite/:token', element: <AcceptInvite /> },
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <Navigate to="/library" replace /> },
      { path: '/library', element: <Library /> },
      { path: '/trash', element: <Library trash /> },
      { path: '/collections', element: <Collections /> },
      { path: '/shared', element: <SharedLinks /> },
      { path: '/people', element: <People /> },
      { path: '/activity', element: <Activity /> },
      { path: '*', element: <Navigate to="/library" replace /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <WarmUpGate>
        <RouterProvider router={router} />
      </WarmUpGate>
    </QueryClientProvider>
  </StrictMode>,
);
