import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Building2, Users, Plug, Shield, LogOut, ArrowLeft
} from 'lucide-react';

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/admin' },
  { icon: Building2, label: 'Empresas', path: '/admin/tenants' },
  { icon: Users, label: 'Usuários', path: '/admin/users' },
  { icon: Plug, label: 'APIs & Integrações', path: '/admin/apis' },
];

export default function AdminLayout() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="flex h-screen w-64 flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-3 px-5 py-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive text-white font-bold text-sm shadow-lg">
            <Shield className="h-5 w-5" />
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-sm font-bold truncate">SaaS Admin</span>
            <span className="text-[11px] text-sidebar-muted">Painel Master</span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-2 space-y-1">
          {navItems.map(item => {
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
                  isActive
                    ? "bg-destructive text-white shadow-md"
                    : "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
                )}
              >
                <item.icon className="h-[18px] w-[18px]" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="p-3 space-y-2">
          <button
            onClick={() => navigate('/pipeline')}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all"
          >
            <ArrowLeft className="h-[18px] w-[18px]" />
            Voltar ao CRM
          </button>
          <div className="flex items-center gap-3 rounded-xl bg-sidebar-accent px-3 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-destructive text-white text-xs font-bold shadow-sm">
              {profile?.full_name?.[0]?.toUpperCase() ?? 'A'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{profile?.full_name ?? 'Admin'}</p>
              <p className="text-[11px] text-sidebar-muted">Super Admin</p>
            </div>
            <button onClick={signOut} className="text-sidebar-muted hover:text-sidebar-foreground transition-colors p-1 rounded-lg hover:bg-sidebar-accent">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
