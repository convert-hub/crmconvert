import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, Trash2, Loader2, Palette } from 'lucide-react';
import { toast } from 'sonner';
import { getTenantBranding, type BrandingConfig } from '@/hooks/useTenantBranding';

export default function BrandingSettings() {
  const { tenant, role, refreshTenant } = useAuth();
  const isAdmin = role === 'admin';
  const [branding, setBranding] = useState<BrandingConfig>({});
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (tenant) {
      setBranding(getTenantBranding(tenant));
    }
  }, [tenant]);

  const saveBranding = async (updated: BrandingConfig) => {
    if (!tenant) return;
    setSaving(true);
    const { data: tenantData } = await supabase.from('tenants').select('settings').eq('id', tenant.id).single();
    const currentSettings = (tenantData?.settings && typeof tenantData.settings === 'object' && !Array.isArray(tenantData.settings))
      ? tenantData.settings as Record<string, any> : {};
    const { error } = await supabase.from('tenants').update({
      settings: { ...currentSettings, branding: updated } as any
    }).eq('id', tenant.id);
    if (error) { toast.error(error.message); setSaving(false); return; }
    setBranding(updated);
    await refreshTenant();
    toast.success('Marca atualizada!');
    setSaving(false);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !tenant) return;
    if (!file.type.startsWith('image/')) { toast.error('Apenas imagens são permitidas'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Máximo 5MB'); return; }

    setUploading(true);
    const ext = file.name.split('.').pop();
    const path = `${tenant.id}/logo.${ext}`;

    // Remove old logo if exists
    if (branding.logo_url) {
      const oldPath = branding.logo_url.split('/tenant-logos/')[1];
      if (oldPath) await supabase.storage.from('tenant-logos').remove([oldPath]);
    }

    const { error } = await supabase.storage.from('tenant-logos').upload(path, file, { upsert: true });
    if (error) { toast.error(error.message); setUploading(false); return; }

    const { data: urlData } = supabase.storage.from('tenant-logos').getPublicUrl(path);
    const logo_url = `${urlData.publicUrl}?t=${Date.now()}`;
    await saveBranding({ ...branding, logo_url });
    setUploading(false);
  };

  const removeLogo = async () => {
    if (!tenant || !branding.logo_url) return;
    const path = branding.logo_url.split('/tenant-logos/')[1];
    if (path) await supabase.storage.from('tenant-logos').remove([path]);
    await saveBranding({ ...branding, logo_url: undefined });
  };

  const handleColorChange = (field: keyof BrandingConfig, value: string) => {
    setBranding(prev => ({ ...prev, [field]: value }));
  };

  const saveColors = () => saveBranding(branding);

  return (
    <div className="space-y-4">
      <Card className="glass-card rounded-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5" />Logo da Empresa</CardTitle>
          <CardDescription>Faça upload da logo que aparecerá na sidebar e na tela de login</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {branding.logo_url ? (
            <div className="flex items-center gap-4">
              <div className="rounded-xl border border-border bg-muted/30 p-4 inline-flex items-center justify-center">
                <img src={branding.logo_url} alt="Logo" className="h-20 w-auto max-w-[200px] object-contain" />
              </div>
              {isAdmin && (
                <div className="flex flex-col gap-2">
                  <label className="cursor-pointer">
                    <Button variant="outline" size="sm" className="rounded-xl" asChild>
                      <span>{uploading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}Alterar</span>
                    </Button>
                    <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                  </label>
                  <Button variant="ghost" size="sm" className="rounded-xl text-destructive" onClick={removeLogo}>
                    <Trash2 className="h-4 w-4 mr-1" />Remover
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border py-10 px-6">
              <Upload className="h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground mb-3">Nenhuma logo configurada</p>
              {isAdmin && (
                <label className="cursor-pointer">
                  <Button variant="outline" className="rounded-xl" asChild>
                    <span>{uploading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}Fazer Upload</span>
                  </Button>
                  <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                </label>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass-card rounded-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Palette className="h-5 w-5" />Cores do Tema</CardTitle>
          <CardDescription>Personalize as cores da interface para sua marca</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label className="text-sm">Cor Primária</Label>
              <div className="flex gap-2 items-center">
                <Input
                  type="color"
                  value={branding.primary_color || '#3B4252'}
                  onChange={e => handleColorChange('primary_color', e.target.value)}
                  className="w-14 h-10 p-1 rounded-xl cursor-pointer"
                  disabled={!isAdmin}
                />
                <Input
                  value={branding.primary_color || '#3B4252'}
                  onChange={e => handleColorChange('primary_color', e.target.value)}
                  className="rounded-xl font-mono text-sm flex-1"
                  placeholder="#3B4252"
                  disabled={!isAdmin}
                />
              </div>
              <p className="text-xs text-muted-foreground">Botões, links e destaques</p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Cor Secundária</Label>
              <div className="flex gap-2 items-center">
                <Input
                  type="color"
                  value={branding.secondary_color || '#F0EDE8'}
                  onChange={e => handleColorChange('secondary_color', e.target.value)}
                  className="w-14 h-10 p-1 rounded-xl cursor-pointer"
                  disabled={!isAdmin}
                />
                <Input
                  value={branding.secondary_color || '#F0EDE8'}
                  onChange={e => handleColorChange('secondary_color', e.target.value)}
                  className="rounded-xl font-mono text-sm flex-1"
                  placeholder="#F0EDE8"
                  disabled={!isAdmin}
                />
              </div>
              <p className="text-xs text-muted-foreground">Fundos secundários e acentos</p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Cor das Fontes</Label>
              <div className="flex gap-2 items-center">
                <Input
                  type="color"
                  value={branding.font_color || '#2B2F3A'}
                  onChange={e => handleColorChange('font_color', e.target.value)}
                  className="w-14 h-10 p-1 rounded-xl cursor-pointer"
                  disabled={!isAdmin}
                />
                <Input
                  value={branding.font_color || '#2B2F3A'}
                  onChange={e => handleColorChange('font_color', e.target.value)}
                  className="rounded-xl font-mono text-sm flex-1"
                  placeholder="#2B2F3A"
                  disabled={!isAdmin}
                />
              </div>
              <p className="text-xs text-muted-foreground">Textos e títulos</p>
            </div>
          </div>

          {/* Preview */}
          <div className="rounded-2xl border border-border p-4 space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pré-visualização</p>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg" style={{ backgroundColor: branding.primary_color || '#3B4252' }} />
              <div className="h-10 w-10 rounded-lg border" style={{ backgroundColor: branding.secondary_color || '#F0EDE8' }} />
              <span className="text-sm font-semibold" style={{ color: branding.font_color || '#2B2F3A' }}>Texto de exemplo</span>
            </div>
          </div>

          {isAdmin && (
            <Button onClick={saveColors} disabled={saving} className="rounded-xl">
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar Cores
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
