import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export interface BrandingConfig {
  logo_url?: string;
  primary_color?: string;
  secondary_color?: string;
  font_color?: string;
  sidebar_color?: string;
}

function hexToHsl(hex: string): string | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;
  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function getTenantBranding(tenant: { settings: Record<string, unknown> } | null): BrandingConfig {
  if (!tenant?.settings) return {};
  const s = tenant.settings as Record<string, any>;
  return s.branding ?? {};
}

export function useTenantBranding() {
  const { tenant } = useAuth();
  const branding = getTenantBranding(tenant);

  useEffect(() => {
    const root = document.documentElement;

    const colorMap: Array<{ hex?: string; vars: string[] }> = [
      { hex: branding.primary_color, vars: ['--primary', '--ring', '--sidebar-primary'] },
      { hex: branding.secondary_color, vars: ['--secondary', '--accent', '--sidebar-accent'] },
      { hex: branding.font_color, vars: ['--foreground', '--card-foreground', '--sidebar-foreground'] },
      { hex: branding.sidebar_color, vars: ['--sidebar-background'] },
    ];

    colorMap.forEach(({ hex, vars }) => {
      if (hex) {
        const hsl = hexToHsl(hex);
        if (hsl) vars.forEach(v => root.style.setProperty(v, hsl));
      } else {
        vars.forEach(v => root.style.removeProperty(v));
      }
    });

    return () => {
      colorMap.forEach(({ vars }) => vars.forEach(v => root.style.removeProperty(v)));
    };
  }, [branding.primary_color, branding.secondary_color, branding.font_color, branding.sidebar_color]);

  return branding;
}
