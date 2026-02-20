import { useAuth } from '@/contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Kanban, MessageSquare, Settings,
  Activity, Zap, Brain, FileText, AlertTriangle, LogOut, Building2
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
    <aside className="flex h-screen w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-bold text-sm">
          CR
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold truncate max-w-[160px]">
            {tenant?.name ?? 'CRM'}
          </span>
          <span className="text-xs text-sidebar-muted capitalize">{role ?? ''}</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4 space-y-1">
        {navItems.map(item => (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              location.pathname === item.path
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-muted hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </button>
        ))}

        {filteredAdminItems.length > 0 && (
          <>
            <div className="pt-4 pb-2 px-3">
              <span className="text-[10px] uppercase tracking-wider text-sidebar-muted font-semibold">
                Administração
              </span>
            </div>
            {filteredAdminItems.map(item => (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  location.pathname === item.path
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-muted hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </button>
            ))}
          </>
        )}
      </nav>

      {/* User */}
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 rounded-lg px-3 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-accent text-sidebar-accent-foreground text-xs font-semibold">
            {profile?.full_name?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{profile?.full_name ?? 'Usuário'}</p>
          </div>
          <button onClick={signOut} className="text-sidebar-muted hover:text-sidebar-foreground transition-colors">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
