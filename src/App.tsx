import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { BrowsePage } from "./pages/BrowsePage";
import { SearchPage } from "./pages/SearchPage";
import { AppDetailPage } from "./pages/AppDetailPage";
import { InstalledPage } from "./pages/InstalledPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AppContextProvider } from "./state/AppContext";

export default function App() {
  return (
    <AppContextProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/browse" replace />} />
          <Route path="/browse" element={<BrowsePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/installed" element={<InstalledPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/app/:owner/:repo" element={<AppDetailPage />} />
          <Route path="*" element={<Navigate to="/browse" replace />} />
        </Routes>
      </Layout>
    </AppContextProvider>
  );
}
