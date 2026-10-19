import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "./lib/authStore";
import Layout from "./components/Layout";
import { Loading } from "./components/ui";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import BusinessesPage from "./pages/BusinessesPage";
import BusinessNewPage from "./pages/BusinessNewPage";
import BusinessDetailPage from "./pages/BusinessDetailPage";
import ActivityPage from "./pages/ActivityPage";
import NotificationsPage from "./pages/NotificationsPage";
import TiersPage from "./pages/TiersPage";
import AdminsPage from "./pages/AdminsPage";

function RequireAuth({ children, superOnly }: { children: JSX.Element; superOnly?: boolean }) {
  const { status, admin } = useAuthStore();

  if (status === "loading") return <Loading />;
  if (status === "signedout" || !admin) return <Navigate to="/login" replace />;
  if (superOnly && admin.role !== "super_admin") {
    return (
      <div className="page">
        <div className="card card-pad">
          <b>Restricted area</b>
          <p className="muted mt" style={{ marginTop: 8 }}>
            Only the super admin can manage {superOnly ? "this section" : "this"}.
          </p>
        </div>
      </div>
    );
  }
  return children;
}

export default function App() {
  const init = useAuthStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/businesses" element={<BusinessesPage />} />
          <Route
            path="/businesses/new"
            element={
              <RequireAuth>
                <BusinessNewPage />
              </RequireAuth>
            }
          />
          <Route path="/businesses/:id" element={<BusinessDetailPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route
            path="/tiers"
            element={
              <RequireAuth superOnly>
                <TiersPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admins"
            element={
              <RequireAuth superOnly>
                <AdminsPage />
              </RequireAuth>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
