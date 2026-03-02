import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { TagDef } from '@/components/settings/TagsSettings';

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

interface TagPickerSelectProps {
  value: string;
  onChange: (tag: string) => void;
  placeholder?: string;
  className?: string;
}

export default function TagPickerSelect({ value, onChange, placeholder = 'Selecionar tag...', className }: TagPickerSelectProps) {
  const { tenant } = useAuth();
  const [tags, setTags] = useState<TagDef[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [saving, setSaving] = useState(false);

  const loadTags = async () => {
    if (!tenant) return;
    const { data } = await supabase.from('tenants').select('settings').eq('id', tenant.id).single();
    if (data?.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) {
      setTags((data.settings as Record<string, any>).tags || []);
    }
  };

  useEffect(() => { loadTags(); }, [tenant]);

  const handleCreate = async () => {
    if (!tenant || !newName.trim()) return;
    const name = newName.trim();
    if (tags.some(t => t.name.toLowerCase() === name.toLowerCase())) {
      toast.error('Tag já existe');
      return;
    }
    setSaving(true);
    const { data: tenantData } = await supabase.from('tenants').select('settings').eq('id', tenant.id).single();
    const currentSettings = (tenantData?.settings && typeof tenantData.settings === 'object' && !Array.isArray(tenantData.settings))
      ? tenantData.settings as Record<string, any> : {};
    const updated = [...(currentSettings.tags || []), { name, color: newColor }];
    const { error } = await supabase.from('tenants').update({ settings: { ...currentSettings, tags: updated } as any }).eq('id', tenant.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setTags(updated);
    onChange(name);
    setNewName('');
    setNewColor(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]);
    setCreateOpen(false);
    toast.success('Tag criada');
  };

  return (
    <>
      <Select value={value || '_empty'} onValueChange={v => {
        if (v === '_create_new') {
          setCreateOpen(true);
        } else if (v !== '_empty') {
          onChange(v);
        }
      }}>
        <SelectTrigger className={`h-9 text-xs ${className || ''}`}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {tags.map(t => (
            <SelectItem key={t.name} value={t.name}>
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                {t.name}
              </div>
            </SelectItem>
          ))}
          <SelectItem value="_create_new">
            <div className="flex items-center gap-2 text-primary">
              <Plus className="h-3 w-3" />
              Criar nova tag
            </div>
          </SelectItem>
        </SelectContent>
      </Select>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle className="text-base">Nova Tag</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome</Label>
              <Input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Ex: VIP, Urgente..."
                className="h-9 text-sm"
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Cor</Label>
              <div className="flex gap-1.5">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    className={`h-7 w-7 rounded-full border-2 transition-all ${newColor === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setNewColor(c)}
                  />
                ))}
              </div>
            </div>
            <Button onClick={handleCreate} disabled={!newName.trim() || saving} className="w-full">
              {saving ? 'Salvando...' : 'Criar tag'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
