import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../lib/authStore";
import { api } from "../lib/api";
import { BrandLogo, Button, Toaster } from "./ui";

const ICONS: Record<string, JSX.Element> = {
  dashboard: (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  businesses: (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01" />
    </svg>
  ),
  activity: (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12h4l3 8 4-16 3 8h4" />
    </svg>
  ),
  bell: (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  ),
  tiers: (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5M3 18l9 5 9-5" />
    </svg>
  ),
  admins: (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
};

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/businesses": "Business customers",
  "/businesses/new": "Register business",
  "/activity": "Activity log",
  "/notifications": "Notifications",
  "/tiers": "Subscription tiers",
  "/admins": "Admin accounts",
};

function titleFor(pathname: string): string {
  if (pathname.startsWith("/businesses/")) return "Business detail";
  return TITLES[pathname] ?? "Kourro Admin";
}

export default function Layout() {
  const { admin, signOut } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await api.get<{ unread: number }>("/notifications?unread=1&limit=1");
        if (alive) setUnread(res.unread);
      } catch {
        /* session handled in api layer */
      }
    };
    load();
    const timer = setInterval(load, 45_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [location.pathname]);

  // Close the mobile drawer on Escape and whenever the viewport grows past
  // the breakpoint (the drawer only exists below it).
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    const onResize = () => {
      if (window.innerWidth > 900) setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [menuOpen]);

  if (!admin) return null;
  const isSuper = admin.role === "super_admin";

  return (
    <div className="shell">
      <aside className={`rail ${menuOpen ? "open" : ""}`}>
        <div className="rail-brand">
          <BrandLogo className="brand-logo" eager />
          <span>Admin portal</span>
        </div>

        <nav className="rail-nav" onClick={() => setMenuOpen(false)}>
          <NavLink to="/" end className={({ isActive }) => `rail-link ${isActive ? "active" : ""}`}>
            {ICONS.dashboard} Dashboard
          </NavLink>
          <NavLink to="/businesses" className={({ isActive }) => `rail-link ${isActive ? "active" : ""}`}>
            {ICONS.businesses} Businesses
          </NavLink>
          <NavLink to="/activity" className={({ isActive }) => `rail-link ${isActive ? "active" : ""}`}>
            {ICONS.activity} Activity log
          </NavLink>
          <NavLink to="/notifications" className={({ isActive }) => `rail-link ${isActive ? "active" : ""}`}>
            {ICONS.bell} Notifications
            {unread > 0 ? <span className="count">{unread}</span> : null}
          </NavLink>

          {isSuper ? (
            <>
              <div className="rail-label">Platform</div>
              <NavLink to="/tiers" className={({ isActive }) => `rail-link ${isActive ? "active" : ""}`}>
                {ICONS.tiers} Subscription tiers
              </NavLink>
              <NavLink to="/admins" className={({ isActive }) => `rail-link ${isActive ? "active" : ""}`}>
                {ICONS.admins} Admin accounts
              </NavLink>
            </>
          ) : null}
        </nav>

        <div className="rail-foot">
          Signed in as
          <br />
          <b style={{ color: "#d9d1ba" }}>{admin.email}</b>
        </div>
      </aside>
      {menuOpen ? <div className="rail-scrim" onClick={() => setMenuOpen(false)} /> : null}

      <div className="main">
        <header className="topbar">
          <button
            className="menu-btn"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
          <h1>{titleFor(location.pathname)}</h1>
          <div className="spacer" />
          <span className={`role-chip ${admin.role}`}>
            {admin.role === "super_admin" ? "Super admin" : admin.role}
          </span>
          <div className="who">
            <b>{admin.fullName}</b>
            <span>{admin.email}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await signOut();
              navigate("/login");
            }}
          >
            Sign out
          </Button>
        </header>

        <main className="page">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  );
}
