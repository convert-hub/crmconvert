import { useAuth } from '@/contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Kanban, MessageSquare, Settings,
  Activity, Zap, Brain, FileText, AlertTriangle, LogOut, Building2, ChevronDown
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard' },
  { icon: Kanban, label: 'Pipeline', path: '/pipeline' },
  { icon: Users, label: 'Contatos', path: '/contacts' },
  { icon: Building2, label: 'Empresas', path: '/companies' },
  { icon: Activity, label: 'Atividades', path: '/activities' },
];

const adminItems = [
  { icon: MessageSquare, label: 'Conversas', path: '/inbox', roles: ['admin', 'manager'] as const },
  { icon: Zap, label: 'Automações', path: '/automations', roles: ['admin', 'manager'] as const },
  { icon: Brain, label: 'Prompt Studio', path: '/prompt-studio', roles: ['admin', 'manager'] as const },
  { icon: Settings, label: 'Configurações', path: '/settings', roles: ['admin'] as const },
  { icon: AlertTriangle, label: 'Jobs & Logs', path: '/jobs', roles: ['admin'] as const },
  { icon: FileText, label: 'Relatórios', path: '/reports', roles: ['admin', 'manager'] as const },
];

export default function AppSidebar() {
  const { tenant, role, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const filteredAdminItems = adminItems.filter(
    item => role && (item.roles as readonly string[]).includes(role)
  );

  return (
    <aside className="flex h-screen w-64 flex-col bg-sidebar text-sidebar-foreground">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary text-white font-bold text-sm shadow-lg shadow-primary/30">
          CR
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <span className="text-sm font-bold truncate">
            {tenant?.name ?? 'CRM'}
          </span>
          <span className="text-[11px] text-sidebar-muted">Workspace</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-2 space-y-1">
        <div className="px-3 pb-2">
          <span className="text-[10px] uppercase tracking-widest text-sidebar-muted font-semibold">
            Geral
          </span>
        </div>
        {navItems.map(item => {
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
                isActive
                  ? "gradient-primary text-white shadow-md shadow-primary/25"
                  : "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
              )}
            >
              <item.icon className="h-[18px] w-[18px]" />
              {item.label}
            </button>
          );
        })}

        {filteredAdminItems.length > 0 && (
          <>
            <div className="pt-6 pb-2 px-3">
              <span className="text-[10px] uppercase tracking-widest text-sidebar-muted font-semibold">
                Administração
              </span>
            </div>
            {filteredAdminItems.map(item => {
              const isActive = location.pathname === item.path;
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
                    isActive
                      ? "gradient-primary text-white shadow-md shadow-primary/25"
                      : "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  )}
                >
                  <item.icon className="h-[18px] w-[18px]" />
                  {item.label}
                </button>
              );
            })}
          </>
        )}
      </nav>

      {/* User */}
      <div className="p-3">
        <div className="flex items-center gap-3 rounded-xl bg-sidebar-accent px-3 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full gradient-warm text-white text-xs font-bold shadow-sm">
            {profile?.full_name?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{profile?.full_name ?? 'Usuário'}</p>
            <p className="text-[11px] text-sidebar-muted capitalize">{role ?? ''}</p>
          </div>
          <button onClick={signOut} className="text-sidebar-muted hover:text-sidebar-foreground transition-colors p-1 rounded-lg hover:bg-sidebar-accent">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
