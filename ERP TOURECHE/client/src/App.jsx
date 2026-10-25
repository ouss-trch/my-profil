import { Suspense, lazy } from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { DEMO } from './lib/demo.js';
import { I18nProvider } from './i18n/index.jsx';
import { AppProvider, useApp } from './components/ProjectContext.jsx';
import { SensitiveProvider } from './components/Sensitive.jsx';
import { Loading, ToastProvider } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';

const pages = {
  Today: lazy(() => import('./pages/Today.jsx')),
  Dashboard: lazy(() => import('./pages/Dashboard.jsx')),
  Advisor: lazy(() => import('./pages/Advisor.jsx')),
  Assistant: lazy(() => import('./pages/Assistant.jsx')),
  Orders: lazy(() => import('./pages/Orders.jsx')),
  Leads: lazy(() => import('./pages/Leads.jsx')),
  Customers: lazy(() => import('./pages/Customers.jsx')),
  Carriers: lazy(() => import('./pages/Carriers.jsx')),
  Products: lazy(() => import('./pages/Products.jsx')),
  ProductEditor: lazy(() => import('./pages/ProductEditor.jsx')),
  Ads: lazy(() => import('./pages/Ads.jsx')),
  Splits: lazy(() => import('./pages/Splits.jsx')),
  Finance: lazy(() => import('./pages/Finance.jsx')),
  Tasks: lazy(() => import('./pages/Tasks.jsx')),
  Contacts: lazy(() => import('./pages/Contacts.jsx')),
  StorePages: lazy(() => import('./pages/StorePages.jsx')),
  Activity: lazy(() => import('./pages/Activity.jsx')),
  Settings: lazy(() => import('./pages/Settings.jsx')),
};

function Gate() {
  const { auth } = useApp();
  if (auth.loading) return <Loading />;
  if (!auth.user) return <Login />;
  const P = pages;
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<P.Today />} />
          <Route path="dashboard" element={<P.Dashboard />} />
          <Route path="advisor" element={<P.Advisor />} />
          <Route path="assistant" element={<P.Assistant />} />
          <Route path="orders" element={<P.Orders />} />
          <Route path="leads" element={<P.Leads />} />
          <Route path="customers" element={<P.Customers />} />
          <Route path="carriers" element={<P.Carriers />} />
          <Route path="products" element={<P.Products />} />
          <Route path="products/:id" element={<P.ProductEditor />} />
          <Route path="ads" element={<P.Ads />} />
          <Route path="splits" element={<P.Splits />} />
          <Route path="splits/:id" element={<P.Splits />} />
          <Route path="finance" element={<P.Finance />} />
          <Route path="tasks" element={<P.Tasks />} />
          <Route path="contacts" element={<P.Contacts />} />
          <Route path="store-pages" element={<P.StorePages />} />
          <Route path="activity" element={<P.Activity />} />
          <Route path="settings" element={<P.Settings />} />
          <Route path="stats" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

// نسخة العرض تُفتح داخل رابط مستضاف: التوجيه بعلامة # بدل مسارات الخادم
const Router = DEMO ? HashRouter : BrowserRouter;

function DemoBanner() {
  const ar = (document.documentElement.lang || 'ar') === 'ar';
  return (
    <div className="sticky top-0 z-[45] bg-warn px-3 py-1.5 text-center text-xs font-semibold text-black">
      {ar ? 'نسخة عرض ببيانات تجريبية — التصفح كامل، والحفظ معطّل. النسخة الحقيقية تعمل على جهازك عبر Tailscale.' : 'Démo avec données fictives — navigation complète, enregistrement désactivé.'}
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <ToastProvider>
        <AppProvider>
          <SensitiveProvider>
            <Router>
              {DEMO && <DemoBanner />}
              <Gate />
            </Router>
          </SensitiveProvider>
        </AppProvider>
      </ToastProvider>
    </I18nProvider>
  );
}
