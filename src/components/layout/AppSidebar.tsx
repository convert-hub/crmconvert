import { useAuth } from '@/contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Kanban, MessageSquare, Settings,
  Activity, Zap, Brain, FileText, AlertTriangle, LogOut, Shield, GitBranch
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getTenantBranding } from '@/hooks/useTenantBranding';
import defaultLogo from '@/assets/logo.png';

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard' },
  { icon: Kanban, label: 'Pipeline', path: '/pipeline' },
  { icon: Users, label: 'Contatos', path: '/contacts' },
  { icon: Activity, label: 'Atividades', path: '/activities' },
];

const adminItems = [
  { icon: MessageSquare, label: 'Conversas', path: '/inbox', roles: ['admin', 'manager'] as const },
  { icon: Zap, label: 'Automações', path: '/automations', roles: ['admin', 'manager'] as const },
  { icon: GitBranch, label: 'Flow Builder', path: '/flow-builder', roles: ['admin', 'manager'] as const },
  { icon: Brain, label: 'Prompt Studio', path: '/prompt-studio', roles: ['admin', 'manager'] as const },
  { icon: Settings, label: 'Configurações', path: '/settings', roles: ['admin'] as const },
  { icon: AlertTriangle, label: 'Jobs & Logs', path: '/jobs', roles: ['admin'] as const },
  { icon: FileText, label: 'Relatórios', path: '/reports', roles: ['admin', 'manager'] as const },
];

export default function AppSidebar() {
  const { tenant, role, profile, signOut, isSaasAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const branding = getTenantBranding(tenant);
  const logoSrc = branding.logo_url || defaultLogo;

  const filteredAdminItems = adminItems.filter(
    item => role && (item.roles as readonly string[]).includes(role)
  );

  const NavButton = ({ item }: { item: typeof navItems[0] }) => {
    const isActive = location.pathname === item.path;
    return (
      <button
        onClick={() => navigate(item.path)}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200",
          isActive
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        )}
      >
        <item.icon className="h-4 w-4" strokeWidth={1.75} />
        {item.label}
      </button>
    );
  };

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Logo */}
      <div className="flex items-center justify-center px-3 py-6">
        <img src={logoSrc} alt={tenant?.name ?? 'Logo'} className="h-28 w-auto object-contain" />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-1 space-y-0.5">
        <div className="px-3 pb-1.5 pt-1">
          <span className="text-[10px] uppercase tracking-wider text-sidebar-muted font-medium">
            Geral
          </span>
        </div>
        {navItems.map(item => <NavButton key={item.path} item={item} />)}

        {filteredAdminItems.length > 0 && (
          <>
            <div className="pt-5 pb-1.5 px-3">
              <span className="text-[10px] uppercase tracking-wider text-sidebar-muted font-medium">
                Administração
              </span>
            </div>
            {filteredAdminItems.map(item => <NavButton key={item.path} item={item} />)}
          </>
        )}
      </nav>

      {/* SaaS Admin Link */}
      {isSaasAdmin && (
        <div className="px-3 pb-1">
          <button
            onClick={() => navigate('/admin')}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-all border border-dashed border-border"
          >
            <Shield className="h-4 w-4" strokeWidth={1.75} />
            Painel SaaS Admin
          </button>
        </div>
      )}

      {/* User */}
      <div className="p-3 border-t border-sidebar-border">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-foreground text-xs font-semibold">
            {profile?.full_name?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium truncate">{profile?.full_name ?? 'Usuário'}</p>
            <p className="text-[11px] text-muted-foreground capitalize">{role ?? ''}</p>
          </div>
          <button onClick={signOut} className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-accent">
            <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </aside>
  );
}
