import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './auth/LoginPage';
import { RequireAdmin, RequireAuth } from './auth/RequireAuth';
import { AppLayout } from './layout/AppLayout';
import { DevicesPage } from './pages/DevicesPage';
import { DevicePage } from './pages/DevicePage';
import { TemplatesPage } from './pages/TemplatesPage';
import { LinksPage } from './pages/LinksPage';
import { TopologyPage } from './pages/TopologyPage';
import { SearchPage } from './pages/SearchPage';
import { TagsPage } from './pages/TagsPage';
import { VlansPage } from './pages/VlansPage';
import { UsersPage } from './pages/UsersPage';
import { SchemaPage } from './pages/SchemaPage';
import { CatalogPage } from './pages/CatalogPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/devices" replace />} />
        <Route path="/devices" element={<DevicesPage />} />
        <Route path="/devices/:deviceId" element={<DevicePage />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/links" element={<LinksPage />} />
        <Route path="/topology" element={<TopologyPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/tags" element={<TagsPage />} />
        <Route path="/vlans" element={<VlansPage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/schema" element={<SchemaPage />} />
        <Route
          path="/users"
          element={
            <RequireAdmin>
              <UsersPage />
            </RequireAdmin>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/devices" replace />} />
    </Routes>
  );
}
