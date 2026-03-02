import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Trash2, Tag } from 'lucide-react';
import { toast } from 'sonner';

export interface TagDef {
  name: string;
  color: string;
}

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

export default function TagsSettings() {
  const { tenant, role } = useAuth();
  const [tags, setTags] = useState<TagDef[]>([]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [tagUsage, setTagUsage] = useState<Record<string, number>>({});
  const isAdmin = role === 'admin';

  useEffect(() => {
    if (tenant) loadTags();
  }, [tenant]);

  const loadTags = async () => {
    if (!tenant) return;
    const { data } = await supabase.from('tenants').select('settings').eq('id', tenant.id).single();
    if (data?.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) {
      const s = data.settings as Record<string, any>;
      setTags(s.tags || []);
    }
    // Count tag usage
    const { data: contacts } = await supabase.from('contacts').select('tags').eq('tenant_id', tenant.id);
    if (contacts) {
      const counts: Record<string, number> = {};
      contacts.forEach(c => {
        (c.tags || []).forEach((t: string) => {
          counts[t] = (counts[t] || 0) + 1;
        });
      });
      setTagUsage(counts);
    }
  };

  const saveTags = async (updated: TagDef[]) => {
    if (!tenant) return;
    const { data: tenantData } = await supabase.from('tenants').select('settings').eq('id', tenant.id).single();
    const currentSettings = (tenantData?.settings && typeof tenantData.settings === 'object' && !Array.isArray(tenantData.settings)) ? tenantData.settings as Record<string, any> : {};
    const { error } = await supabase.from('tenants').update({ settings: { ...currentSettings, tags: updated } as any }).eq('id', tenant.id);
    if (error) { toast.error(error.message); return false; }
    setTags(updated);
    return true;
  };

  const addTag = async () => {
    if (!newName.trim()) return;
    const name = newName.trim();
    if (tags.some(t => t.name.toLowerCase() === name.toLowerCase())) {
      toast.error('Tag já existe');
      return;
    }
    const updated = [...tags, { name, color: newColor }];
    if (await saveTags(updated)) {
      setNewName('');
      setNewColor(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]);
      toast.success('Tag adicionada');
    }
  };

  const removeTag = async (name: string) => {
    const updated = tags.filter(t => t.name !== name);
    if (await saveTags(updated)) {
      toast.success('Tag removida');
    }
  };

  return (
    <Card className="glass-card rounded-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Tag className="h-5 w-5" />Tags</CardTitle>
        <CardDescription>Gerencie as tags disponíveis para contatos. Tags com cores facilitam a visualização.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {tags.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Cor</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Uso</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tags.map(t => (
                <TableRow key={t.name}>
                  <TableCell>
                    <div className="h-4 w-4 rounded-full" style={{ backgroundColor: t.color }} />
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="rounded-full text-[12px] font-normal"
                      style={{ borderColor: t.color, color: t.color }}
                    >
                      {t.name}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {tagUsage[t.name] || 0} contato{(tagUsage[t.name] || 0) !== 1 ? 's' : ''}
                  </TableCell>
                  <TableCell>
                    {isAdmin && (
                      <Button variant="ghost" size="icon" onClick={() => removeTag(t.name)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">Nenhuma tag cadastrada.</p>
        )}

        {isAdmin && (
          <div className="space-y-3 rounded-2xl border border-border/50 p-4 bg-card/50">
            <p className="text-sm font-medium text-foreground">Nova tag</p>
            <div className="flex gap-3 items-end">
              <div className="space-y-1.5 flex-1">
                <Label className="text-xs">Nome</Label>
                <Input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Ex: VIP, Urgente, Novo..."
                  className="rounded-xl"
                  onKeyDown={e => e.key === 'Enter' && addTag()}
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
              <Button onClick={addTag} disabled={!newName.trim()} className="rounded-xl">
                <Plus className="h-4 w-4 mr-1" />Adicionar
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
