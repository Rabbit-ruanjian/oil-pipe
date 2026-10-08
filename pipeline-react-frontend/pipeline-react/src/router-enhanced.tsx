/**
 * Enhanced Router with Prefetch
 */

import { createBrowserRouter, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { Spin } from 'antd';
import MainLayout from './components/layout/MainLayoutFixed';
import { useUserStore } from './stores/userStore';

const Login = lazy(() => import('./pages/auth/Login'));
const Dashboard = lazy(() => import('./pages/dashboard/Dashboard'));

const ProjectList = lazy(() => import('./pages/data/ProjectList'));
const PipelineList = lazy(() => import('./pages/data/PipelineList'));
const PumpStationList = lazy(() => import('./pages/data/PumpStationList'));
const OilPropertyList = lazy(() => import('./pages/data/OilPropertyList'));
const KnowledgeEntry = lazy(() => import('./pages/ai/KnowledgeEntry'));

const HydraulicAnalysis = lazy(() => import('./pages/calculation/HydraulicAnalysis'));
const Optimization = lazy(() => import('./pages/calculation/Optimization'));
const SensitivityAnalysis = lazy(() => import('./pages/calculation/SensitivityAnalysis'));

const Report = lazy(() => import('./pages/report/Report'));
const AIChat = lazy(() => import('./pages/ai/AIChat'));
const ReportPreview = lazy(() => import('./pages/ai/ReportPreview'));
const ReportHistoryDetail = lazy(async () => {
  const module = await import('./pages/ai/ReportPreview');
  return { default: module.ReportHistoryDetailPage };
});

const Loading = () => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100%',
      minHeight: '400px',
    }}
  >
    <Spin size="large" tip="加载中..." />
  </div>
);

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isLoggedIn = useUserStore((s) => s.isLoggedIn);
  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export function prefetchRoute(path: string) {
  const routeMap: Record<string, () => Promise<unknown>> = {
    '/dashboard': () => import('./pages/dashboard/Dashboard'),
    '/data/project': () => import('./pages/data/ProjectList'),
    '/analysis/hydraulic': () => import('./pages/calculation/HydraulicAnalysis'),
    '/ai/chat': () => import('./pages/ai/AIChat'),
    '/ai/trace': () => import('./pages/ai/KnowledgeEntry'),
  };

  const loader = routeMap[path];
  if (loader) {
    loader().catch(() => {
      // Ignore prefetch failures.
    });
  }
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: (
      <Suspense fallback={<Loading />}>
        <Login />
      </Suspense>
    ),
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <MainLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <Navigate to="/dashboard" replace />,
      },
      {
        path: 'dashboard',
        element: (
          <Suspense fallback={<Loading />}>
            <Dashboard />
          </Suspense>
        ),
      },
      {
        path: 'data/project',
        element: (
          <Suspense fallback={<Loading />}>
            <ProjectList />
          </Suspense>
        ),
      },
      {
        path: 'data/pipeline',
        element: (
          <Suspense fallback={<Loading />}>
            <PipelineList />
          </Suspense>
        ),
      },
      {
        path: 'data/pump',
        element: (
          <Suspense fallback={<Loading />}>
            <PumpStationList />
          </Suspense>
        ),
      },
      {
        path: 'data/oil',
        element: (
          <Suspense fallback={<Loading />}>
            <OilPropertyList />
          </Suspense>
        ),
      },
      {
        path: 'data/knowledge',
        element: <Navigate to="/ai/trace" replace />,
      },
      {
        path: 'calculation/hydraulic',
        element: <Navigate to="/analysis/hydraulic" replace />,
      },
      {
        path: 'calculation/optimization',
        element: <Navigate to="/analysis/optimization" replace />,
      },
      {
        path: 'calculation/sensitivity',
        element: <Navigate to="/analysis/sensitivity" replace />,
      },
      {
        path: 'analysis/hydraulic',
        element: (
          <Suspense fallback={<Loading />}>
            <HydraulicAnalysis />
          </Suspense>
        ),
      },
      {
        path: 'analysis/optimization',
        element: (
          <Suspense fallback={<Loading />}>
            <Optimization />
          </Suspense>
        ),
      },
      {
        path: 'analysis/sensitivity',
        element: (
          <Suspense fallback={<Loading />}>
            <SensitivityAnalysis />
          </Suspense>
        ),
      },
      {
        path: 'report',
        element: (
          <Suspense fallback={<Loading />}>
            <Report />
          </Suspense>
        ),
      },
      {
        path: 'ai/chat',
        element: (
          <Suspense fallback={<Loading />}>
            <AIChat />
          </Suspense>
        ),
      },
      {
        path: 'ai/knowledge',
        element: <Navigate to="/ai/trace" replace />,
      },
      {
        path: 'ai/trace',
        element: (
          <Suspense fallback={<Loading />}>
            <KnowledgeEntry />
          </Suspense>
        ),
      },
      {
        path: 'ai/report',
        element: (
          <Suspense fallback={<Loading />}>
            <ReportPreview />
          </Suspense>
        ),
      },
      {
        path: 'ai/report/detail/:historyId',
        element: (
          <Suspense fallback={<Loading />}>
            <ReportHistoryDetail />
          </Suspense>
        ),
      },
    ],
  },
]);
