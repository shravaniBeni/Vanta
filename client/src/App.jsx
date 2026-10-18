/**
 * client/src/App.jsx
 *
 * Phase 6: Real authentication with protected routes.
 *
 * Public routes (no auth required):
 *   /Login
 *   /Chat?id=<embed_id>   — public deployed chatbot widget
 *
 * Protected routes (redirect to /Login if no session):
 *   /              → Dashboard
 *   /Dashboard
 *   /Home
 *   /Editor
 *   /Deploy
 *
 * While session is loading, show a spinner rather than redirecting.
 */

import {
  BrowserRouter as Router,
  Route,
  Routes,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClientInstance } from "@/lib/query-client";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import { Toaster } from "@/components/ui/toaster";

import Layout from "@/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Home from "@/pages/Home";
import Chat from "@/pages/Chat";
import Editor from "@/pages/Editor";
import Deploy from "@/pages/Deploy";
import Architect from "@/pages/Architect";
import Analytics from "@/pages/Analytics";

// ─── Loading spinner ──────────────────────────────────────────────────────────

function AuthLoader() {
  return (
    <div className="fixed inset-0 bg-[#080c14] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// ─── Protected route wrapper ──────────────────────────────────────────────────

function RequireAuth({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) return <AuthLoader />;

  if (!isAuthenticated) {
    return <Navigate to="/Login" state={{ from: location }} replace />;
  }

  return children;
}

// ─── Root redirect ────────────────────────────────────────────────────────────
// / → Dashboard if authenticated, Login if not

function RootRedirect() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <AuthLoader />;
  return <Navigate to={isAuthenticated ? "/Dashboard" : "/Login"} replace />;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

function AppRoutes() {
  return (
    <Routes>
      {/* Root */}
      <Route path="/" element={<RootRedirect />} />

      {/* Public */}
      <Route path="/Login" element={<Login />} />

      {/* Public embed chat — no auth required */}
      <Route
        path="/Chat"
        element={
          <Layout>
            <Chat />
          </Layout>
        }
      />

      {/* Protected */}
      <Route
        path="/Dashboard"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/Home"
        element={
          <RequireAuth>
            <Layout>
              <Home />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/Editor"
        element={
          <RequireAuth>
            <Layout>
              <Editor />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/Deploy"
        element={
          <RequireAuth>
            <Layout>
              <Deploy />
            </Layout>
          </RequireAuth>
        }
      />

      {/* Phase 7: AI Architect onboarding */}
      <Route
        path="/Architect"
        element={
          <RequireAuth>
            <Architect />
          </RequireAuth>
        }
      />

      {/* Phase 10C: Analytics dashboard */}
      <Route
        path="/Analytics"
        element={
          <RequireAuth>
            <Analytics />
          </RequireAuth>
        }
      />

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AppRoutes />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}
