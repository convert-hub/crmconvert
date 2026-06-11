import { useEffect, useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectGroup, SelectLabel, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Upload, FileText, AlertTriangle, Download } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { normalizeBrazilPhone } from '@/lib/phone';

// Parses DD/MM/YYYY, DD-MM-YYYY, DD/MM/YY or ISO YYYY-MM-DD. Returns 'YYYY-MM-DD' or null.
function parseDateBR(input: string): string | null {
  if (!input) return null;
  const s = input.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const y = +iso[1], m = +iso[2], d = +iso[3];
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return s;
  }
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    let d = +dmy[1], m = +dmy[2], y = +dmy[3];
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
  }
  return null;
}

interface ImportContactsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  onImported: () => void;
}

type CsvRow = Record<string, string>;

type CustomFieldDef = { key: string; label: string; type: 'text'|'number'|'date'|'select'|'boolean'; options?: string[] };

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

const CONTACT_FIELDS = [
  { value: 'skip', label: 'Ignorar' },
  { value: 'name', label: 'Nome' },
  { value: 'phone', label: 'Telefone' },
  { value: 'email', label: 'Email' },
  { value: 'status', label: 'Status' },
  { value: 'tags', label: 'Tags' },
  { value: 'birth_date', label: 'Data Nascimento' },
  { value: 'city', label: 'Cidade' },
  { value: 'state', label: 'Estado' },
  { value: 'source', label: 'Origem' },
  { value: 'notes', label: 'Notas' },
];

const normKey = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '').trim();

function guessMapping(header: string, customDefs: CustomFieldDef[] = []): string {
  const h = header.toLowerCase().trim();
  if (/^nome|name|full.?name/i.test(h)) return 'name';
  if (/^telefone|phone|whatsapp|celular|fone/i.test(h)) return 'phone';
  if (/^e?-?mail/i.test(h)) return 'email';
  if (/^status/i.test(h)) return 'status';
  if (/^tag/i.test(h)) return 'tags';
  if (/^nasc|birth|aniversário|aniversario/i.test(h)) return 'birth_date';
  if (/^cidade|city/i.test(h)) return 'city';
  if (/^estado|state|uf/i.test(h)) return 'state';
  if (/^origem|source/i.test(h)) return 'source';
  if (/^nota|note|obs/i.test(h)) return 'notes';
  // Custom fields: try matching by label or key
  const nh = normKey(header);
  for (const fd of customDefs) {
    if (normKey(fd.label) === nh || normKey(fd.key) === nh) return `custom:${fd.key}`;
  }
  return 'skip';
}

// RFC 4180-style CSV parser: handles quoted fields, escaped quotes ("") and embedded delimiters/newlines.
function parseCSV(text: string): { headers: string[]; rows: CsvRow[] } {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  if (!text.trim()) return { headers: [], rows: [] };

  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const delimiter = semiCount > commaCount ? ';' : ',';

  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === delimiter) { record.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') {
        record.push(field); field = '';
        if (record.some(v => v.length > 0)) records.push(record);
        record = [];
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    if (record.some(v => v.length > 0)) records.push(record);
  }

  if (records.length < 1) return { headers: [], rows: [] };
  const headers = records[0].map(h => h.trim());
  const rows: CsvRow[] = [];
  for (let i = 1; i < records.length; i++) {
    const r = records[i];
    const row: CsvRow = {};
    headers.forEach((h, idx) => { row[h] = (r[idx] ?? '').trim(); });
    rows.push(row);
  }
  return { headers, rows };
}

interface ImportError { row: number; reason: string; data: Record<string, string> }

export default function ImportContactsDialog({ open, onOpenChange, tenantId, onImported }: ImportContactsDialogProps) {
  const [step, setStep] = useState<'upload' | 'mapping' | 'importing'>('upload');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importResult, setImportResult] = useState<{ created: number; updated: number; errors: ImportError[] } | null>(null);
  const [progress, setProgress] = useState(0);
  const [customDefs, setCustomDefs] = useState<CustomFieldDef[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !tenantId) return;
    supabase.from('tenants').select('settings').eq('id', tenantId).single().then(({ data }) => {
      if (data?.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) {
        const s = data.settings as Record<string, any>;
        setCustomDefs(Array.isArray(s.custom_contact_fields) ? s.custom_contact_fields : []);
      }
    });
  }, [open, tenantId]);

  const fieldLabel = (value: string): string => {
    if (value.startsWith('custom:')) {
      const key = value.slice(7);
      return customDefs.find(d => d.key === key)?.label ?? key;
    }
    return CONTACT_FIELDS.find(f => f.value === value)?.label ?? value;
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { headers: h, rows: r } = parseCSV(text);
      if (h.length === 0) { toast.error('CSV inválido'); return; }
      setHeaders(h);
      setRows(r);
      const autoMapping: Record<string, string> = {};
      h.forEach(header => { autoMapping[header] = guessMapping(header, customDefs); });
      setMapping(autoMapping);
      setStep('mapping');
    };
    reader.readAsText(file, 'UTF-8');
  };

  const coerceCustom = (def: CustomFieldDef, val: string): { ok: true; value: unknown } | { ok: false; reason: string } => {
    const v = val.trim();
    if (!v) return { ok: true, value: undefined };
    switch (def.type) {
      case 'text': return { ok: true, value: v };
      case 'number': {
        const n = parseFloat(v.replace(',', '.'));
        if (Number.isNaN(n)) return { ok: false, reason: `Campo "${def.label}": número inválido "${val}"` };
        return { ok: true, value: n };
      }
      case 'date': {
        const parsed = parseDateBR(v);
        if (!parsed) return { ok: false, reason: `Campo "${def.label}": data inválida "${val}" (use DD/MM/AAAA)` };
        return { ok: true, value: parsed };
      }
      case 'select': {
        const opts = def.options ?? [];
        const match = opts.find(o => normKey(o) === normKey(v));
        if (!match) return { ok: false, reason: `Campo "${def.label}": valor "${val}" não está nas opções (${opts.join(', ')})` };
        return { ok: true, value: match };
      }
      case 'boolean': {
        const lc = normKey(v);
        if (['sim', 'true', '1', 'yes', 'y', 's'].includes(lc)) return { ok: true, value: true };
        if (['nao', 'false', '0', 'no', 'n'].includes(lc)) return { ok: true, value: false };
        return { ok: false, reason: `Campo "${def.label}": boolean inválido "${val}" (use Sim/Não)` };
      }
    }
  };

  const handleImport = async () => {
    const nameCol = Object.entries(mapping).find(([, v]) => v === 'name')?.[0];
    if (!nameCol) { toast.error('Mapeie pelo menos a coluna "Nome"'); return; }

    setStep('importing');
    setProgress(0);
    let created = 0, updated = 0;
    const errors: ImportError[] = [];
    const seenByPhone = new Map<string, { id: string; tags: string[]; custom_fields: Record<string, unknown> }>();
    const seenByEmail = new Map<string, { id: string; tags: string[]; custom_fields: Record<string, unknown> }>();
    const allTagsUsed = new Set<string>();

    const mergeTags = (a: string[] = [], b: string[] = []) => {
      const out: string[] = [];
      const seen = new Set<string>();
      [...a, ...b].forEach(t => {
        const k = t.trim();
        if (!k) return;
        const lc = k.toLowerCase();
        if (seen.has(lc)) return;
        seen.add(lc);
        out.push(k);
      });
      return out;
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const c: any = { tenant_id: tenantId };
        let rawPhone = '';
        let rawBirth = '';
        let birthInvalid = false;
        const customFields: Record<string, unknown> = {};
        let customError: string | null = null;

        for (const [csvCol, field] of Object.entries(mapping)) {
          const val = row[csvCol];
          if (field === 'skip' || !val) continue;
          if (field.startsWith('custom:')) {
            const key = field.slice(7);
            const def = customDefs.find(d => d.key === key);
            if (!def) continue;
            const res = coerceCustom(def, val);
            if (res && res.ok === false) { customError = res.reason; break; }
            if (res && res.ok === true && res.value !== undefined) customFields[key] = res.value;
          } else if (field === 'phone') { rawPhone = val; c.phone = normalizeBrazilPhone(val); }
          else if (field === 'tags') c.tags = val.split(/[;,]/).map((t: string) => t.trim()).filter(Boolean);
          else if (field === 'birth_date') {
            rawBirth = val;
            const parsed = parseDateBR(val);
            if (parsed) c.birth_date = parsed;
            else birthInvalid = true;
          }
          else c[field] = val;
        }

        if (customError) {
          errors.push({ row: i + 2, reason: customError, data: row });
          continue;
        }
        if (rawPhone && !c.phone) {
          errors.push({ row: i + 2, reason: `Telefone inválido: "${rawPhone}"`, data: row });
          continue;
        }
        if (birthInvalid) {
          errors.push({ row: i + 2, reason: `Data de nascimento inválida: "${rawBirth}" (use DD/MM/AAAA)`, data: row });
          continue;
        }
        if (!c.name) c.name = 'Sem nome';
        if (!c.status) c.status = 'lead';
        (c.tags || []).forEach((t: string) => allTagsUsed.add(t));
        const hasCustom = Object.keys(customFields).length > 0;

        let existing: { id: string; tags: string[]; custom_fields: Record<string, unknown> } | null = null;
        if (c.phone && seenByPhone.has(c.phone)) existing = seenByPhone.get(c.phone)!;
        else if (c.email && seenByEmail.has(c.email)) existing = seenByEmail.get(c.email)!;

        if (!existing && c.phone) {
          const { data } = await supabase.from('contacts').select('id, tags, custom_fields').eq('tenant_id', tenantId).eq('phone', c.phone).limit(1);
          if (data && data.length > 0) existing = { id: data[0].id, tags: (data[0].tags as string[]) || [], custom_fields: (data[0].custom_fields as Record<string, unknown>) || {} };
        }
        if (!existing && c.email) {
          const { data } = await supabase.from('contacts').select('id, tags, custom_fields').eq('tenant_id', tenantId).eq('email', c.email).limit(1);
          if (data && data.length > 0) existing = { id: data[0].id, tags: (data[0].tags as string[]) || [], custom_fields: (data[0].custom_fields as Record<string, unknown>) || {} };
        }

        if (existing) {
          const mergedTags = mergeTags(existing.tags, c.tags || []);
          const mergedCustom = hasCustom ? { ...existing.custom_fields, ...customFields } : existing.custom_fields;
          const { tenant_id, tags: _t, ...rest } = c;
          const updateData: any = { ...rest, tags: mergedTags };
          if (hasCustom) updateData.custom_fields = mergedCustom;
          const { error } = await supabase.from('contacts').update(updateData).eq('id', existing.id);
          if (error) throw error;
          updated++;
          existing.tags = mergedTags;
          existing.custom_fields = mergedCustom;
          if (c.phone) seenByPhone.set(c.phone, existing);
          if (c.email) seenByEmail.set(c.email, existing);
        } else {
          if (hasCustom) c.custom_fields = customFields;
          const { data: ins, error } = await supabase.from('contacts').insert(c).select('id').single();
          if (error) throw error;
          created++;
          const entry = { id: ins!.id, tags: c.tags || [], custom_fields: customFields };
          if (c.phone) seenByPhone.set(c.phone, entry);
          if (c.email) seenByEmail.set(c.email, entry);
        }
      } catch (e: any) {
        console.error('[ImportContacts] row failed', i + 2, e);
        errors.push({ row: i + 2, reason: e?.message || String(e), data: row });
      }
      setProgress(Math.round(((i + 1) / rows.length) * 100));
    }

    // Auto-register new tags
    if (allTagsUsed.size > 0) {
      try {
        const { data: tData } = await supabase.from('tenants').select('settings').eq('id', tenantId).single();
        const settings = (tData?.settings && typeof tData.settings === 'object' && !Array.isArray(tData.settings))
          ? tData.settings as Record<string, any> : {};
        const existing: Array<{ name: string; color: string }> = Array.isArray(settings.tags) ? settings.tags : [];
        const existingLc = new Set(existing.map(t => t.name.toLowerCase()));
        const toAdd: Array<{ name: string; color: string }> = [];
        allTagsUsed.forEach(name => {
          if (!existingLc.has(name.toLowerCase())) {
            toAdd.push({ name, color: PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)] });
          }
        });
        if (toAdd.length > 0) {
          await supabase.from('tenants').update({ settings: { ...settings, tags: [...existing, ...toAdd] } as any }).eq('id', tenantId);
        }
      } catch (e) {
        console.error('[ImportContacts] failed to register new tags', e);
      }
    }

    setImportResult({ created, updated, errors });
    const msg = `${created} criados, ${updated} atualizados${errors.length ? `, ${errors.length} com erro` : ''}`;
    if (errors.length === 0) toast.success(`Importação concluída: ${msg}`);
    else toast.warning(`Importação concluída com falhas: ${msg}`);
    onImported();
  };

  const downloadErrorsCsv = () => {
    if (!importResult || importResult.errors.length === 0) return;
    const cols = ['linha', 'motivo', ...headers];
    const escape = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = [cols.map(escape).join(',')];
    importResult.errors.forEach(e => {
      lines.push([escape(String(e.row)), escape(e.reason), ...headers.map(h => escape(e.data[h] || ''))].join(','));
    });
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `erros-importacao-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setStep('upload');
    setHeaders([]);
    setRows([]);
    setMapping({});
    setImportResult(null);
    setProgress(0);
  };

  const handleClose = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Upload className="h-4 w-4" /> Importar Contatos via CSV
          </DialogTitle>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4">
            <div
              className="border-2 border-dashed border-border rounded-lg p-12 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium text-foreground">Clique para selecionar um arquivo CSV</p>
              <p className="text-xs text-muted-foreground mt-1">Suporta vírgula (,) e ponto-e-vírgula (;), campos entre aspas</p>
            </div>
            <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
          </div>
        )}

        {step === 'mapping' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <span>{rows.length} linhas encontradas. Mapeie as colunas abaixo:</span>
            </div>

            <div className="space-y-2">
              {headers.map(header => (
                <div key={header} className="flex items-center gap-3">
                  <span className="text-sm font-medium w-40 truncate" title={header}>{header}</span>
                  <Select value={mapping[header] || 'skip'} onValueChange={v => setMapping(m => ({ ...m, [header]: v }))}>
                    <SelectTrigger className="w-48 h-8 text-[13px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CONTACT_FIELDS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                      {customDefs.length > 0 && (
                        <SelectGroup>
                          <SelectLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">Campos personalizados</SelectLabel>
                          {customDefs.map(fd => (
                            <SelectItem key={`custom:${fd.key}`} value={`custom:${fd.key}`}>{fd.label}</SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground truncate flex-1">{rows[0]?.[header] || '-'}</span>
                </div>
              ))}
            </div>

            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-2">Preview (primeiras 3 linhas):</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    {headers.filter(h => mapping[h] !== 'skip').map(h => (
                      <TableHead key={h} className="text-[11px]">{fieldLabel(mapping[h])}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 3).map((row, i) => (
                    <TableRow key={i}>
                      {headers.filter(h => mapping[h] !== 'skip').map(h => (
                        <TableCell key={h} className="text-[12px] py-1">{row[h]}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={reset}>Voltar</Button>
              <Button onClick={handleImport} className="flex-1">Importar {rows.length} contatos</Button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div className="py-6 space-y-4">
            {importResult ? (
              <>
                <p className="text-base font-semibold text-foreground text-center">Importação concluída</p>
                <div className="flex justify-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-sm py-1 px-3">{importResult.created} criados</Badge>
                  <Badge variant="outline" className="text-sm py-1 px-3">{importResult.updated} atualizados</Badge>
                  {importResult.errors.length > 0 && (
                    <Badge variant="destructive" className="text-sm py-1 px-3">{importResult.errors.length} erros</Badge>
                  )}
                </div>

                {importResult.errors.length > 0 && (
                  <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-foreground">Linhas com falha (mostrando até 20):</p>
                      <Button variant="ghost" size="sm" onClick={downloadErrorsCsv} className="h-7 text-xs">
                        <Download className="h-3 w-3 mr-1" /> Baixar CSV completo
                      </Button>
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {importResult.errors.slice(0, 20).map((e, idx) => (
                        <div key={idx} className="text-[11px] text-muted-foreground flex gap-2">
                          <span className="font-mono text-foreground/70">L{e.row}</span>
                          <span className="flex-1">{e.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-center">
                  <Button onClick={() => handleClose(false)}>Fechar</Button>
                </div>
              </>
            ) : (
              <div className="text-center space-y-3">
                <div className="h-8 w-8 mx-auto border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-muted-foreground">Importando contatos... {progress}%</p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
