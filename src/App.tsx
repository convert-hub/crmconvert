import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import AppLayout from "@/components/layout/AppLayout";
import Login from "@/pages/Login";
import WaitingApproval from "@/pages/WaitingApproval";
import DashboardPage from "@/pages/DashboardPage";
import PipelinePage from "@/pages/PipelinePage";
import ContactsPage from "@/pages/ContactsPage";
import InboxPage from "@/pages/InboxPage";
import SettingsPage from "@/pages/SettingsPage";
import JobsPage from "@/pages/JobsPage";
import AutomationsPage from "@/pages/AutomationsPage";
import PromptStudioPage from "@/pages/PromptStudioPage";
import ReportsPage from "@/pages/ReportsPage";
import FlowBuilderPage from "@/pages/FlowBuilderPage";
import CampaignsPage from "@/pages/CampaignsPage";

import ActivitiesPage from "@/pages/ActivitiesPage";
import AdminLayout from "@/pages/admin/AdminLayout";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminTenants from "@/pages/admin/AdminTenants";
import AdminUsers from "@/pages/admin/AdminUsers";
import AdminApis from "@/pages/admin/AdminApis";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

function AppRoutes() {
  const { session, membership, isSaasAdmin, loading } = useAuth();

  if (loading) return null;

  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to={isSaasAdmin && !membership ? "/admin" : "/pipeline"} /> : <Login />} />
      <Route path="/waiting" element={
        <ProtectedRoute><WaitingApproval /></ProtectedRoute>
      } />

      {/* SaaS Admin routes */}
      <Route path="/admin" element={
        <ProtectedRoute>
          {isSaasAdmin ? <AdminLayout /> : <Navigate to="/pipeline" />}
        </ProtectedRoute>
      }>
        <Route index element={<AdminDashboard />} />
        <Route path="tenants" element={<AdminTenants />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="apis" element={<AdminApis />} />
      </Route>

      {/* CRM routes */}
      <Route path="/" element={
        <ProtectedRoute>
          {(membership || (isSaasAdmin && session)) ? <AppLayout /> : (isSaasAdmin ? <Navigate to="/admin" /> : <Navigate to="/waiting" />)}
        </ProtectedRoute>
      }>
        <Route index element={<Navigate to="/pipeline" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="pipeline" element={<PipelinePage />} />
        <Route path="contacts" element={<ContactsPage />} />
        
        <Route path="activities" element={<ActivitiesPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="automations" element={<AutomationsPage />} />
        <Route path="campaigns" element={<CampaignsPage />} />
        <Route path="flow-builder" element={<FlowBuilderPage />} />
        <Route path="prompt-studio" element={<PromptStudioPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="jobs" element={<JobsPage />} />
        <Route path="reports" element={<ReportsPage />} />
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
