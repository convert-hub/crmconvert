import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';

interface FieldDef { key: string; label?: string }

interface Props {
  tenantId: string | null;
  /** Chave do campo selecionado (ex: "cargo"). */
  value: string;
  onChange: (key: string, label?: string) => void;
}

/** Gera a chave a partir do nome amigável: "Faturamento Mensal" -> "faturamento_mensal". */
// eslint-disable-next-line no-misleading-character-class
const slugify = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * Seletor de campo personalizado do contato. O usuário NUNCA digita a chave:
 * escolhe da lista oficial (Configurações → tenants.settings.custom_contact_fields)
 * ou cria um campo novo digitando só o nome amigável — a chave é gerada e
 * registrada automaticamente.
 */
export default function ContactCustomFieldPicker({ tenantId, value, onChange }: Props) {
  const [defs, setDefs] = useState<FieldDef[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    let alive = true;
    supabase.from('tenants').select('settings').eq('id', tenantId).single()
      .then(({ data, error }) => {
        if (!alive) return;
        setLoaded(true);
        if (error) { toast.error(`Erro ao carregar campos: ${error.message}`); return; }
        const arr = (data?.settings as any)?.custom_contact_fields;
        setDefs(Array.isArray(arr) ? arr.filter((f: any) => f && typeof f.key === 'string') : []);
      });
    return () => { alive = false; };
  }, [tenantId]);

  const createField = async () => {
    const label = newLabel.trim();
    if (!label || !tenantId) return;
    const key = slugify(label);
    if (!key) { toast.error('Nome de campo inválido'); return; }
    if (defs.some(d => d.key === key)) {
      // Já existe um campo equivalente — só seleciona
      onChange(key, defs.find(d => d.key === key)?.label ?? label);
      setCreating(false); setNewLabel('');
      return;
    }
    setSaving(true);
    const { data, error: readErr } = await supabase.from('tenants').select('settings').eq('id', tenantId).single();
    if (readErr) { toast.error(`Erro ao ler configurações: ${readErr.message}`); setSaving(false); return; }
    const settings = (data?.settings && typeof data.settings === 'object' && !Array.isArray(data.settings))
      ? { ...(data.settings as Record<string, unknown>) } : {};
    const list = Array.isArray((settings as any).custom_contact_fields)
      ? [...(settings as any).custom_contact_fields] : [];
    list.push({ key, label });
    (settings as any).custom_contact_fields = list;
    const { error } = await supabase.from('tenants').update({ settings }).eq('id', tenantId);
    setSaving(false);
    if (error) {
      toast.error(`Não foi possível criar o campo (sem permissão?). Crie em Configurações. ${error.message}`);
      return;
    }
    setDefs(list);
    onChange(key, label);
    setCreating(false); setNewLabel('');
    toast.success(`Campo "${label}" criado`);
  };

  const known = defs.some(d => d.key === value);
  const selectValue = creating ? '__new__' : (value ? value : '__placeholder__');

  return (
    <div className="space-y-1.5">
      <Select
        value={selectValue}
        onValueChange={(v) => {
          if (v === '__new__') { setCreating(true); return; }
          if (v === '__placeholder__') return;
          setCreating(false);
          const def = defs.find(d => d.key === v);
          onChange(v, def?.label);
        }}
      >
        <SelectTrigger className="h-9 text-xs">
          <SelectValue placeholder={loaded ? 'Escolha o campo…' : 'Carregando…'} />
        </SelectTrigger>
        <SelectContent>
          {!value && !creating && (
            <SelectItem value="__placeholder__" disabled>Escolha o campo…</SelectItem>
          )}
          {defs.map(d => (
            <SelectItem key={d.key} value={d.key}>{d.label || d.key}</SelectItem>
          ))}
          {value && !known && (
            <SelectItem value={value}>{value} (fora das Configurações)</SelectItem>
          )}
          <SelectItem value="__new__">
            <span className="flex items-center gap-1.5"><Plus className="h-3 w-3" />Criar novo campo…</span>
          </SelectItem>
        </SelectContent>
      </Select>
      {creating && (
        <div className="flex gap-1.5">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createField(); if (e.key === 'Escape') { setCreating(false); setNewLabel(''); } }}
            placeholder="Nome do campo (ex: Cargo)"
            className="h-8 text-xs flex-1"
            autoFocus
          />
          <Button size="sm" className="h-8 text-xs" onClick={createField} disabled={saving || !newLabel.trim()}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Criar'}
          </Button>
        </div>
      )}
      {creating && newLabel.trim() && (
        <p className="text-[10px] text-muted-foreground">Será salvo como <code>{slugify(newLabel)}</code></p>
      )}
    </div>
  );
}
