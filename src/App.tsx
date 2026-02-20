import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import AppLayout from "@/components/layout/AppLayout";
import Login from "@/pages/Login";
import Onboarding from "@/pages/Onboarding";
import DashboardPage from "@/pages/DashboardPage";
import PipelinePage from "@/pages/PipelinePage";
import ContactsPage from "@/pages/ContactsPage";
import InboxPage from "@/pages/InboxPage";
import SettingsPage from "@/pages/SettingsPage";
import JobsPage from "@/pages/JobsPage";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

function AppRoutes() {
  const { session, membership, loading } = useAuth();

  if (loading) return null;

  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/pipeline" /> : <Login />} />
      <Route path="/onboarding" element={
        <ProtectedRoute>
          <Onboarding />
        </ProtectedRoute>
      } />
      <Route path="/" element={
        <ProtectedRoute>
          {membership ? <AppLayout /> : <Navigate to="/onboarding" />}
        </ProtectedRoute>
      }>
        <Route index element={<Navigate to="/pipeline" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="pipeline" element={<PipelinePage />} />
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="companies" element={<div className="p-6"><h1 className="text-2xl font-bold">Empresas</h1><p className="text-muted-foreground mt-2">Em breve</p></div>} />
        <Route path="activities" element={<div className="p-6"><h1 className="text-2xl font-bold">Atividades</h1><p className="text-muted-foreground mt-2">Em breve</p></div>} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="automations" element={<div className="p-6"><h1 className="text-2xl font-bold">Automações</h1><p className="text-muted-foreground mt-2">Em breve</p></div>} />
        <Route path="prompt-studio" element={<div className="p-6"><h1 className="text-2xl font-bold">Prompt Studio</h1><p className="text-muted-foreground mt-2">Em breve</p></div>} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="jobs" element={<JobsPage />} />
        <Route path="reports" element={<div className="p-6"><h1 className="text-2xl font-bold">Relatórios</h1><p className="text-muted-foreground mt-2">Em breve</p></div>} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
