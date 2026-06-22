import { useEffect, useMemo, useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectGroup, SelectLabel, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Upload, FileText, AlertTriangle, Download, Check, X, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { normalizeBrazilPhone } from '@/lib/phone';
import * as XLSX from 'xlsx';

// Decode an ArrayBuffer trying UTF-8 first; fall back to Windows-1252 when mojibake (Ã/Â) is detected.
function decodeBufferSmart(buf: ArrayBuffer): { text: string; encoding: 'utf-8' | 'windows-1252' } {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  const sample = utf8.slice(0, 4000);
  // Mojibake heuristic: Latin-1 chars decoded as UTF-8 produce sequences like "Ã¡", "Ã©", "Ã­", "Ã³", "Ãº", "Ã§", "Ã£", "Ãª", "Ãµ", "Â"
  const mojibakeHits = (sample.match(/Ã[\u0080-\u00ff]|Â[\u0080-\u00ff]/g) || []).length;
  if (mojibakeHits >= 3) {
    try {
      const text = new TextDecoder('windows-1252', { fatal: false }).decode(buf);
      return { text, encoding: 'windows-1252' };
    } catch {
      return { text: utf8, encoding: 'utf-8' };
    }
  }
  return { text: utf8, encoding: 'utf-8' };
}

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
  { value: 'pipeline_stage', label: 'Etapa do Pipeline' },
];

const normKey = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '').trim();

function guessMapping(header: string, customDefs: CustomFieldDef[] = []): string {
  const raw = header.toLowerCase().trim();
  // strip punctuation/parens for fuzzy matching ("Status (Etapa)" -> "status etapa")
  const h = raw.replace(/[()[\]{}.,;:_\-/\\|]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Pipeline stage FIRST so "Status (Etapa)" / "Status Etapa" / "Etapa Status" don't fall into plain 'status'
  if (/\b(etapa|estagio|stage|pipeline|funil|fase)\b/.test(h)) return 'pipeline_stage';
  if (/\b(status)\s+(etapa|pipeline|funil|fase|stage)\b/.test(h)) return 'pipeline_stage';
  if (/^nome\b|^name\b|^full.?name/.test(h)) return 'name';
  if (/^telefone\b|^phone\b|whatsapp|celular|fone/.test(h)) return 'phone';
  if (/^e?-?mail\b/.test(h)) return 'email';
  if (/^status\b/.test(h)) return 'status';
  if (/^tag/.test(h)) return 'tags';
  if (/nasc|birth|aniversario/.test(h)) return 'birth_date';
  if (/^cidade\b|^city\b/.test(h)) return 'city';
  if (/^estado\b|^state\b|^uf\b/.test(h)) return 'state';
  if (/^origem\b|^source\b/.test(h)) return 'source';
  if (/^nota|^note|^obs|coment/.test(h)) return 'notes';
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

interface OppConflict {
  opportunityId: string;
  contactName: string;
  currentStageId: string;
  currentStageName: string;
  targetStageId: string;
  targetStageName: string;
  selected: boolean;
}

interface ImportResult {
  created: number;
  updated: number;
  errors: ImportError[];
  oppsCreated: number;
  oppsIgnored: number;
  oppsConflicts: number;
  oppsUpdated: number;
  stageErrors: number;
}

type Pipeline = { id: string; name: string };
type Stage = { id: string; name: string };

const isLegacyStageConflictError = (reason: string) => {
  const normalized = reason.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return normalized.includes('tem etapas diferentes em') || normalized.includes('etapas diferentes em');
};

export default function ImportContactsDialog({ open, onOpenChange, tenantId, onImported }: ImportContactsDialogProps) {
  const [step, setStep] = useState<'upload' | 'mapping' | 'importing' | 'conflicts'>('upload');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressDetail, setProgressDetail] = useState('');
  const [customDefs, setCustomDefs] = useState<CustomFieldDef[]>([]);
  const [oppCustomKeys, setOppCustomKeys] = useState<Set<string>>(new Set());
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<string>('');
  const [conflicts, setConflicts] = useState<OppConflict[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);

  const hasPipelineStageMapping = Object.values(mapping).includes('pipeline_stage');
  const selectedPipelineName = pipelines.find(p => p.id === selectedPipeline)?.name || '';

  const EMPTY_PHONE_TOKENS = new Set(['', '-', '—', '--', '()', 'n/a', 'na', 'sem', 'sem telefone', 'nao informado', 'não informado', 'nao tem', 'não tem', '.', '0']);

  const mergeTagsList = (a: string[] = [], b: string[] = []): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    [...a, ...b].forEach(t => {
      const k = (t ?? '').trim();
      if (!k) return;
      const lc = k.toLowerCase();
      if (seen.has(lc)) return;
      seen.add(lc); out.push(k);
    });
    return out;
  };

  useEffect(() => {
    if (!open || !tenantId) return;
    supabase.from('tenants').select('settings').eq('id', tenantId).single().then(({ data }) => {
      if (data?.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) {
        const s = data.settings as Record<string, any>;
        const contactFields: CustomFieldDef[] = Array.isArray(s.custom_contact_fields) ? s.custom_contact_fields : [];
        const oppFields: CustomFieldDef[] = Array.isArray(s.custom_opportunity_fields) ? s.custom_opportunity_fields : [];
        // Unifica por key (campos que aparecem em ambos os escopos não duplicam no dropdown)
        const merged = new Map<string, CustomFieldDef>();
        [...contactFields, ...oppFields].forEach(fd => { if (fd?.key) merged.set(fd.key, fd); });
        setCustomDefs(Array.from(merged.values()));
        setOppCustomKeys(new Set(oppFields.map(fd => fd.key).filter(Boolean)));
      }
    });
    supabase.from('pipelines').select('id,name').eq('tenant_id', tenantId).order('position').then(({ data }) => {
      setPipelines((data as Pipeline[]) || []);
    });
  }, [open, tenantId]);

  useEffect(() => {
    if (!selectedPipeline) { setStages([]); return; }
    supabase.from('stages').select('id,name').eq('pipeline_id', selectedPipeline).order('position').then(({ data }) => {
      setStages((data as Stage[]) || []);
    });
  }, [selectedPipeline]);

  const fieldLabel = (value: string): string => {
    if (value.startsWith('custom:')) {
      const key = value.slice(7);
      return customDefs.find(d => d.key === key)?.label ?? key;
    }
    return CONTACT_FIELDS.find(f => f.value === value)?.label ?? value;
  };

  const handleFile = (file: File) => {
    setImportResult(null);
    setConflicts([]);
    setProgress(0);
    setProgressDetail('');
    cancelRef.current = false;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buf = e.target?.result as ArrayBuffer;
        if (!buf) throw new Error('Arquivo vazio');
        const bytes = new Uint8Array(buf);
        const isXlsx = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
          || file.name.toLowerCase().endsWith('.xlsx');

        let h: string[] = [];
        let r: CsvRow[] = [];
        let encUsed: 'utf-8' | 'windows-1252' | 'xlsx' = 'utf-8';

        if (isXlsx && bytes[0] === 0x50) {
          const wb = XLSX.read(buf, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '', raw: false, blankrows: false });
          if (aoa.length === 0) throw new Error('Planilha vazia');
          h = (aoa[0] as unknown[]).map(v => String(v ?? '').trim());
          r = aoa.slice(1).map(row => {
            const obj: CsvRow = {};
            h.forEach((header, idx) => { obj[header] = String((row as unknown[])[idx] ?? '').trim(); });
            return obj;
          });
          encUsed = 'xlsx';
        } else {
          const { text, encoding } = decodeBufferSmart(buf);
          encUsed = encoding;
          const parsed = parseCSV(text);
          h = parsed.headers;
          r = parsed.rows;
        }

        if (h.length === 0) { toast.error('Arquivo sem cabeçalho'); return; }
        setHeaders(h);
        setRows(r);
        const autoMapping: Record<string, string> = {};
        h.forEach(header => { autoMapping[header] = guessMapping(header, customDefs); });
        setMapping(autoMapping);
        setStep('mapping');
        if (encUsed === 'windows-1252') {
          toast.info('Arquivo em Latin-1 detectado e convertido para UTF-8 automaticamente.');
        }
      } catch (err: any) {
        console.error('[ImportContacts] file parse failed', err);
        toast.error(`Falha ao ler arquivo: ${err?.message || err}`);
      }
    };
    reader.readAsArrayBuffer(file);
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
    const stageCol = Object.entries(mapping).find(([, v]) => v === 'pipeline_stage')?.[0];
    if (stageCol && !selectedPipeline) { toast.error('Selecione o pipeline'); return; }

    cancelRef.current = false;
    setImportResult(null);
    setConflicts([]);
    setStep('importing');
    setProgress(0);
    setProgressDetail('Preparando linhas…');
    const t0 = Date.now();
    console.log('[ImportContacts] start', { rows: rows.length, pipeline: selectedPipeline, batchSize: 200 });

    const errors: ImportError[] = [];
    const allTagsUsed = new Set<string>();
    const stagesByNormName = new Map(stages.map(s => [normKey(s.name), s]));

    // ===== PASS 1: parse + validate every row in memory =====
    type Prepared = { rowIdx: number; contact: any; rawStage: string; custom: Record<string, unknown>; hasCustom: boolean };
    const prepared: Prepared[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const c: any = { tenant_id: tenantId };
      let rawPhone = '', rawBirth = '', rawStage = '';
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
        } else if (field === 'phone') {
          rawPhone = val;
          const cleaned = val.trim().toLowerCase();
          if (!EMPTY_PHONE_TOKENS.has(cleaned)) {
            const norm = normalizeBrazilPhone(val);
            if (norm) c.phone = norm;
          }
        } else if (field === 'tags') {
          c.tags = val.split(/[;,]/).map((t: string) => t.trim()).filter(Boolean);
        } else if (field === 'birth_date') {
          rawBirth = val;
          const parsed = parseDateBR(val);
          if (parsed) c.birth_date = parsed;
          else birthInvalid = true;
        } else if (field === 'pipeline_stage') {
          rawStage = val;
        } else {
          c[field] = val;
        }
      }

      if (customError) { errors.push({ row: i + 2, reason: customError, data: row }); continue; }
      if (rawPhone && !c.phone) {
        const cleaned = rawPhone.trim().toLowerCase();
        if (!EMPTY_PHONE_TOKENS.has(cleaned)) {
          errors.push({ row: i + 2, reason: `Telefone com menos de 8 dígitos: "${rawPhone}"`, data: row });
          continue;
        }
      }
      if (birthInvalid) { errors.push({ row: i + 2, reason: `Data nascimento inválida: "${rawBirth}" (use DD/MM/AAAA)`, data: row }); continue; }
      if (!c.name) c.name = 'Sem nome';
      if (!c.status) c.status = 'lead';
      (c.tags || []).forEach((t: string) => allTagsUsed.add(t));

      prepared.push({
        rowIdx: i + 2,
        contact: c,
        rawStage,
        custom: customFields,
        hasCustom: Object.keys(customFields).length > 0,
      });
    }

    // ===== PASS 2: in-memory dedup by phone (then email) =====
    type Bucket = { contact: any; custom: Record<string, unknown>; hasCustom: boolean; rawStages: string[]; rowIdxs: number[] };
    const byPhone = new Map<string, Bucket>();
    const byEmail = new Map<string, Bucket>();
    const noKey: Bucket[] = [];

    const mergeInto = (b: Bucket, p: Prepared) => {
      b.contact.tags = mergeTagsList(b.contact.tags || [], p.contact.tags || []);
      if (p.hasCustom) { b.custom = { ...b.custom, ...p.custom }; b.hasCustom = true; }
      if (p.rawStage) b.rawStages.push(p.rawStage);
      b.rowIdxs.push(p.rowIdx);
      // fill blanks from later rows (e.g. email shows up later)
      ['email', 'birth_date', 'city', 'state', 'source', 'notes'].forEach(f => {
        if (!b.contact[f] && p.contact[f]) b.contact[f] = p.contact[f];
      });
    };

    for (const p of prepared) {
      const phone = p.contact.phone;
      const email = p.contact.email;
      let bucket: Bucket | undefined;
      if (phone) bucket = byPhone.get(phone);
      if (!bucket && email) bucket = byEmail.get(email);
      if (bucket) { mergeInto(bucket, p); continue; }
      const b: Bucket = {
        contact: { ...p.contact, tags: p.contact.tags || [] },
        custom: { ...p.custom },
        hasCustom: p.hasCustom,
        rawStages: p.rawStage ? [p.rawStage] : [],
        rowIdxs: [p.rowIdx],
      };
      if (phone) byPhone.set(phone, b);
      else if (email) byEmail.set(email, b);
      else noKey.push(b);
    }

    const allBuckets = [...byPhone.values(), ...byEmail.values(), ...noKey];
    console.log('[ImportContacts] prepared', {
      rowsTotal: rows.length, rowsValid: prepared.length,
      uniqueContacts: allBuckets.length, preErrors: errors.length,
    });

    // ===== PASS 3: batched upsert =====
    const BATCH_SIZE = 200;
    let created = 0, updated = 0;
    let oppsCreated = 0, oppsIgnored = 0, oppsUpdated = 0, stageErrors = 0;
    const conflictsAcc: OppConflict[] = [];
    const conflictByOppId = new Map<string, OppConflict>();
    const totalBatches = Math.max(1, Math.ceil(allBuckets.length / BATCH_SIZE));

    for (let bi = 0; bi < totalBatches; bi++) {
      if (cancelRef.current) { console.warn('[ImportContacts] cancelled at batch', bi + 1); break; }
      const batch = allBuckets.slice(bi * BATCH_SIZE, (bi + 1) * BATCH_SIZE);
      const tb = Date.now();
      const processedSoFar = bi * BATCH_SIZE;
      setProgressDetail(`Lote ${bi + 1}/${totalBatches} — ${processedSoFar}/${allBuckets.length} contatos únicos`);

      const withPhone = batch.filter(b => b.contact.phone);
      const withoutPhone = batch.filter(b => !b.contact.phone);
      const bucketToId = new Map<Bucket, string>();

      // ----- contacts with phone: lookup, then split insert/update -----
      try {
        if (withPhone.length > 0) {
          const phones = withPhone.map(b => b.contact.phone);
          const { data: existingRows, error: lookupErr } = await supabase
            .from('contacts')
            .select('id, phone, tags, custom_fields')
            .eq('tenant_id', tenantId)
            .in('phone', phones);
          if (lookupErr) throw lookupErr;
          const existingByPhone = new Map((existingRows || []).map((r: any) => [r.phone, r]));

          const toInsert: any[] = [];
          const toInsertBuckets: Bucket[] = [];
          const updateOps: { bucket: Bucket; id: string; payload: any }[] = [];

          for (const b of withPhone) {
            const ex: any = existingByPhone.get(b.contact.phone);
            if (ex) {
              const payload: any = { ...b.contact, tags: mergeTagsList(ex.tags || [], b.contact.tags || []) };
              delete payload.tenant_id;
              if (b.hasCustom) payload.custom_fields = { ...(ex.custom_fields || {}), ...b.custom };
              updateOps.push({ bucket: b, id: ex.id, payload });
              bucketToId.set(b, ex.id);
            } else {
              const payload: any = { ...b.contact, tags: b.contact.tags || [] };
              if (b.hasCustom) payload.custom_fields = b.custom;
              toInsert.push(payload);
              toInsertBuckets.push(b);
            }
          }

          // Insert news in one round-trip
          if (toInsert.length > 0) {
            const { data: inserted, error: insErr } = await supabase
              .from('contacts')
              .insert(toInsert)
              .select('id, phone');
            if (insErr) throw insErr;
            const idByPhone = new Map((inserted || []).map((r: any) => [r.phone, r.id]));
            toInsertBuckets.forEach(b => {
              const id = idByPhone.get(b.contact.phone);
              if (id) bucketToId.set(b, id);
            });
            created += toInsert.length;
          }

          // Updates per-row (Postgres-REST doesn't batch heterogeneous updates)
          for (const op of updateOps) {
            const { error: updErr } = await supabase.from('contacts').update(op.payload).eq('id', op.id);
            if (updErr) {
              op.bucket.rowIdxs.forEach(rowIdx => {
                errors.push({ row: rowIdx, reason: `Atualização falhou: ${updErr.message}`, data: rows[rowIdx - 2] || {} });
              });
              bucketToId.delete(op.bucket);
            } else {
              updated++;
            }
          }
        }
      } catch (e: any) {
        console.error('[ImportContacts] batch', bi + 1, 'contacts(with phone) failed', e);
        withPhone.forEach(b => b.rowIdxs.forEach(rowIdx => {
          errors.push({ row: rowIdx, reason: `Lote ${bi + 1}: ${e?.message || e}`, data: rows[rowIdx - 2] || {} });
        }));
      }


      // ----- contacts without phone: lookup by email, else insert -----
      for (const b of withoutPhone) {
        try {
          let id: string | undefined;
          if (b.contact.email) {
            const { data } = await supabase.from('contacts').select('id, tags, custom_fields')
              .eq('tenant_id', tenantId).eq('email', b.contact.email).limit(1);
            if (data && data.length) {
              const ex: any = data[0];
              id = ex.id;
              const updateData: any = { ...b.contact, tags: mergeTagsList(ex.tags || [], b.contact.tags || []) };
              delete updateData.tenant_id;
              if (b.hasCustom) updateData.custom_fields = { ...(ex.custom_fields || {}), ...b.custom };
              const { error } = await supabase.from('contacts').update(updateData).eq('id', id);
              if (error) throw error;
              updated++;
            }
          }
          if (!id) {
            const payload: any = { ...b.contact, tags: b.contact.tags || [] };
            if (b.hasCustom) payload.custom_fields = b.custom;
            const { data: ins, error } = await supabase.from('contacts').insert(payload).select('id').single();
            if (error) throw error;
            id = ins!.id;
            created++;
          }
          bucketToId.set(b, id);
        } catch (e: any) {
          console.error('[ImportContacts] contact(no phone) failed', e);
          b.rowIdxs.forEach(rowIdx => {
            errors.push({ row: rowIdx, reason: e?.message || String(e), data: rows[rowIdx - 2] || {} });
          });
        }
      }

      // ----- opportunities batch -----
      if (selectedPipeline && stages.length > 0) {
        type OppReq = { bucket: Bucket; contactId: string; matched: Stage };
        const oppReqs: OppReq[] = [];
        for (const b of batch) {
          const contactId = bucketToId.get(b);
          if (!contactId) continue;
          // Etapas inexistentes no pipeline são ignoradas silenciosamente.
          // Quando o mesmo contato aparece em múltiplas linhas com etapas válidas diferentes,
          // a última linha da planilha vence (geralmente é a informação mais recente).
          let chosen: Stage | undefined;
          for (let k = b.rawStages.length - 1; k >= 0; k--) {
            const s = stagesByNormName.get(normKey(b.rawStages[k]));
            if (s) { chosen = s; break; }
          }
          if (!chosen) continue;
          oppReqs.push({ bucket: b, contactId, matched: chosen });
        }

        if (oppReqs.length > 0) {
          try {
            const contactIds = oppReqs.map(r => r.contactId);
            const { data: existingOpps } = await supabase.from('opportunities')
              .select('id, contact_id, stage_id')
              .eq('tenant_id', tenantId)
              .eq('pipeline_id', selectedPipeline)
              .eq('status', 'open')
              .in('contact_id', contactIds);
            const existingByContact = new Map((existingOpps || []).map((o: any) => [o.contact_id, o]));

            const toInsert: any[] = [];
            for (const req of oppReqs) {
              const ex: any = existingByContact.get(req.contactId);
              if (!ex) {
                const oppCf: Record<string, unknown> = {};
                if (req.bucket.hasCustom && oppCustomKeys.size > 0) {
                  for (const k of Object.keys(req.bucket.custom)) {
                    if (oppCustomKeys.has(k)) oppCf[k] = req.bucket.custom[k];
                  }
                }
                const oppPayload: any = {
                  tenant_id: tenantId,
                  contact_id: req.contactId,
                  pipeline_id: selectedPipeline,
                  stage_id: req.matched.id,
                  title: req.bucket.contact.name,
                  value: 0,
                  priority: 'medium',
                  status: 'open',
                };
                if (Object.keys(oppCf).length > 0) oppPayload.custom_fields = oppCf;
                toInsert.push(oppPayload);
              } else if (ex.stage_id === req.matched.id) {
                oppsIgnored++;
              } else if (!conflictByOppId.has(ex.id)) {
                const currentStageName = stages.find(s => s.id === ex.stage_id)?.name || '(desconhecida)';
                const cf: OppConflict = {
                  opportunityId: ex.id,
                  contactName: req.bucket.contact.name,
                  currentStageId: ex.stage_id,
                  currentStageName,
                  targetStageId: req.matched.id,
                  targetStageName: req.matched.name,
                  selected: true,
                };
                conflictByOppId.set(ex.id, cf);
                conflictsAcc.push(cf);
              }
            }

            if (toInsert.length > 0) {
              const { error: oppErr } = await supabase.from('opportunities').insert(toInsert);
              if (oppErr) throw oppErr;
              oppsCreated += toInsert.length;
            }
          } catch (e: any) {
            console.error('[ImportContacts] batch', bi + 1, 'opps failed', e);
            // não falha contatos do batch — apenas registra
            oppReqs.forEach(r => errors.push({
              row: r.bucket.rowIdxs[0],
              reason: `Oportunidade não criada: ${e?.message || e}`,
              data: rows[r.bucket.rowIdxs[0] - 2] || {},
            }));
          }
        }
      }

      const progressPct = Math.round(((bi + 1) / totalBatches) * 100);
      setProgress(progressPct);
      console.log('[ImportContacts] batch', bi + 1, '/', totalBatches, 'done in', Date.now() - tb, 'ms', { created, updated, errors: errors.length });
    }

    // Auto-register new tags
    if (allTagsUsed.size > 0 && !cancelRef.current) {
      try {
        const { data: tData } = await supabase.from('tenants').select('settings').eq('id', tenantId).single();
        const settings = (tData?.settings && typeof tData.settings === 'object' && !Array.isArray(tData.settings))
          ? tData.settings as Record<string, any> : {};
        const existing: Array<{ name: string; color: string }> = Array.isArray(settings.tags) ? settings.tags : [];
        const existingLc = new Set(existing.map(t => t.name.toLowerCase()));
        const toAdd: Array<{ name: string; color: string }> = [];
        allTagsUsed.forEach(name => {
          if (!existingLc.has(name.toLowerCase())) toAdd.push({ name, color: PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)] });
        });
        if (toAdd.length > 0) {
          await supabase.from('tenants').update({ settings: { ...settings, tags: [...existing, ...toAdd] } as any }).eq('id', tenantId);
        }
      } catch (e) {
        console.error('[ImportContacts] failed to register new tags', e);
      }
    }

    const visibleErrors = errors.filter(e => !isLegacyStageConflictError(e.reason));
    const suppressedLegacyStageErrors = errors.length - visibleErrors.length;
    if (suppressedLegacyStageErrors > 0) {
      console.warn('[ImportContacts] suppressed legacy duplicate-stage errors', suppressedLegacyStageErrors);
    }

    const totalMs = Date.now() - t0;
    console.log('[ImportContacts] complete', { created, updated, errors: visibleErrors.length, suppressedLegacyStageErrors, ms: totalMs, cancelled: cancelRef.current });

    const result: ImportResult = { created, updated, errors: visibleErrors, oppsCreated, oppsIgnored, oppsConflicts: conflictsAcc.length, oppsUpdated, stageErrors };
    setImportResult(result);
    setConflicts(conflictsAcc);
    setProgressDetail(`Concluído em ${(totalMs / 1000).toFixed(1)}s`);

    const msg = `${created} criados, ${updated} atualizados${visibleErrors.length ? `, ${visibleErrors.length} com erro` : ''}`;
    if (cancelRef.current) toast.warning(`Importação cancelada: ${msg}`);
    else if (visibleErrors.length === 0) toast.success(`Importação concluída em ${(totalMs / 1000).toFixed(1)}s: ${msg}`);
    else toast.warning(`Importação concluída com falhas: ${msg}`);
    onImported();

    if (conflictsAcc.length > 0) setStep('conflicts');
  };


  const applyConflicts = async () => {
    const toApply = conflicts.filter(c => c.selected);
    let updatedCount = 0;
    for (const cf of toApply) {
      const { error } = await supabase
        .from('opportunities')
        .update({ stage_id: cf.targetStageId })
        .eq('id', cf.opportunityId)
        .eq('tenant_id', tenantId);
      if (!error) updatedCount++;
    }
    setImportResult(r => r ? { ...r, oppsUpdated: r.oppsUpdated + updatedCount } : r);
    if (updatedCount > 0) toast.success(`${updatedCount} oportunidade(s) atualizada(s)`);
    onImported();
    setStep('importing');
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
    setProgressDetail('');
    setSelectedPipeline('');
    setStages([]);
    setConflicts([]);
    cancelRef.current = false;
  };

  const handleClose = (o: boolean) => {
    if (!o && step === 'importing' && !importResult) {
      // protege contra fechamento acidental durante importação
      const ok = window.confirm('A importação está em andamento. Cancelar e fechar?');
      if (!ok) return;
      cancelRef.current = true;
    }
    if (!o) reset();
    onOpenChange(o);
  };

  // Agrupa erros por motivo (top categorias) para visão rápida
  const errorGroups = useMemo(() => {
    if (!importResult?.errors.length) return [] as Array<{ reason: string; count: number }>;
    const normalizeReason = (r: string) => r
      .replace(/"[^"]*"/g, '"…"')                     // collapse quoted values
      .replace(/\b[0-9a-f]{8}-[0-9a-f-]+\b/gi, '<id>') // collapse uuids
      .replace(/\d+/g, 'N')                            // collapse numbers
      .slice(0, 120);
    const counts = new Map<string, number>();
    importResult.errors.forEach(e => {
      const k = normalizeReason(e.reason);
      counts.set(k, (counts.get(k) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [importResult]);



  // Unique stage values from CSV column mapped to pipeline_stage, with match status vs. pipeline stages
  const stageCsvCol = useMemo(
    () => Object.entries(mapping).find(([, v]) => v === 'pipeline_stage')?.[0],
    [mapping],
  );
  const stageAudit = useMemo(() => {
    if (!stageCsvCol || !selectedPipeline) return null;
    const byNorm = new Map(stages.map(s => [normKey(s.name), s]));
    const counts = new Map<string, number>();
    for (const row of rows) {
      const v = (row[stageCsvCol] || '').trim();
      if (!v) continue;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    const items = Array.from(counts.entries()).map(([value, count]) => ({
      value,
      count,
      matched: byNorm.has(normKey(value)),
    }));
    items.sort((a, b) => Number(a.matched) - Number(b.matched) || b.count - a.count);
    const missing = items.filter(i => !i.matched);
    return { items, missingCount: missing.length, missingValues: missing.map(i => i.value) };
  }, [rows, stageCsvCol, selectedPipeline, stages]);

  const [creatingStages, setCreatingStages] = useState(false);
  const createMissingStages = async () => {
    if (!stageAudit || stageAudit.missingValues.length === 0 || !selectedPipeline) return;
    setCreatingStages(true);
    try {
      const { data: existing } = await supabase
        .from('stages').select('position').eq('pipeline_id', selectedPipeline).order('position', { ascending: false }).limit(1);
      let pos = (existing && existing[0]?.position != null) ? Number(existing[0].position) + 1 : 0;
      const payload = stageAudit.missingValues.map(name => ({
        pipeline_id: selectedPipeline,
        name,
        position: pos++,
      }));
      const { error } = await supabase.from('stages').insert(payload as any);
      if (error) throw error;
      toast.success(`${payload.length} etapa(s) criada(s) em "${selectedPipelineName}"`);
      // reload stages
      const { data } = await supabase.from('stages').select('id,name').eq('pipeline_id', selectedPipeline).order('position');
      setStages((data as Stage[]) || []);
    } catch (e: any) {
      toast.error(`Falha ao criar etapas: ${e?.message || e}`);
    } finally {
      setCreatingStages(false);
    }
  };


  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Upload className="h-4 w-4" /> Importar Contatos (CSV ou Excel)
          </DialogTitle>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4">
            <div
              className="border-2 border-dashed border-border rounded-lg p-12 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium text-foreground">Clique para selecionar um arquivo CSV ou Excel</p>
              <p className="text-xs text-muted-foreground mt-1">.csv, .xlsx — encoding (UTF-8 / Latin-1) detectado automaticamente</p>
            </div>
            <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx" className="hidden"
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

            {hasPipelineStageMapping && (
              <div className="space-y-2">
                <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
                  <span className="text-sm font-medium">Pipeline</span>
                  <Select value={selectedPipeline} onValueChange={setSelectedPipeline}>
                    <SelectTrigger className="h-8 text-[13px] flex-1"><SelectValue placeholder="Selecione…" /></SelectTrigger>
                    <SelectContent>
                      {pipelines.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">{stages.length} etapas</span>
                </div>

                {stageAudit && stageAudit.items.length > 0 && (
                  <div className="rounded-lg border border-border bg-card p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-foreground">
                        Etapas encontradas no arquivo
                        {stageAudit.missingCount > 0 && (
                          <span className="ml-2 text-destructive">({stageAudit.missingCount} sem correspondência)</span>
                        )}
                      </p>
                      {stageAudit.missingCount > 0 && (
                        <Button
                          variant="outline" size="sm" className="h-7 text-xs"
                          onClick={createMissingStages} disabled={creatingStages}
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          {creatingStages ? 'Criando…' : `Criar ${stageAudit.missingCount} faltantes`}
                        </Button>
                      )}
                    </div>
                    <div className="max-h-32 overflow-y-auto flex flex-wrap gap-1.5">
                      {stageAudit.items.map(it => (
                        <span
                          key={it.value}
                          className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${
                            it.matched
                              ? 'border-success/30 bg-success/5 text-success'
                              : 'border-destructive/30 bg-destructive/5 text-destructive'
                          }`}
                        >
                          {it.matched ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                          <span className="truncate max-w-[180px]">{it.value}</span>
                          <span className="opacity-60">×{it.count}</span>
                        </span>
                      ))}
                    </div>
                    {stageAudit.missingCount > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        Contatos serão importados normalmente. Linhas com etapa sem correspondência apenas não criarão oportunidade.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}


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
              <Button
                onClick={handleImport}
                className="flex-1"
                disabled={hasPipelineStageMapping && !selectedPipeline}
              >
                Importar {rows.length} contatos
              </Button>
            </div>
          </div>
        )}

        {step === 'conflicts' && importResult && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <span>{conflicts.length} oportunidade(s) já existem em etapa diferente. Selecione as que devem ser atualizadas:</span>
            </div>
            <div className="flex items-center gap-2 px-1">
              <Checkbox
                checked={conflicts.every(c => c.selected)}
                onCheckedChange={(v) => setConflicts(cs => cs.map(c => ({ ...c, selected: !!v })))}
              />
              <span className="text-xs text-muted-foreground">Selecionar todos</span>
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1 rounded-lg border border-border">
              {conflicts.map((c, idx) => (
                <div key={c.opportunityId} className="flex items-center gap-3 px-3 py-2 border-b border-border last:border-0 text-[13px]">
                  <Checkbox
                    checked={c.selected}
                    onCheckedChange={(v) => setConflicts(cs => cs.map((x, i) => i === idx ? { ...x, selected: !!v } : x))}
                  />
                  <span className="font-medium flex-1 truncate">{c.contactName}</span>
                  <span className="text-muted-foreground truncate">{c.currentStageName} → <span className="text-foreground">{c.targetStageName}</span></span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep('importing')}>Pular</Button>
              <Button onClick={applyConflicts} className="flex-1" disabled={!conflicts.some(c => c.selected)}>
                Atualizar selecionadas ({conflicts.filter(c => c.selected).length})
              </Button>
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
                  {importResult.oppsCreated > 0 && (
                    <Badge variant="outline" className="text-sm py-1 px-3">{importResult.oppsCreated} oport. criadas</Badge>
                  )}
                  {importResult.oppsIgnored > 0 && (
                    <Badge variant="outline" className="text-sm py-1 px-3">{importResult.oppsIgnored} oport. iguais</Badge>
                  )}
                  {importResult.oppsConflicts > 0 && (
                    <Badge variant="outline" className="text-sm py-1 px-3">{importResult.oppsConflicts} conflitos</Badge>
                  )}
                  {importResult.oppsUpdated > 0 && (
                    <Badge variant="outline" className="text-sm py-1 px-3">{importResult.oppsUpdated} oport. atualizadas</Badge>
                  )}
                  {importResult.stageErrors > 0 && (
                    <Badge variant="destructive" className="text-sm py-1 px-3">{importResult.stageErrors} etapas inválidas</Badge>
                  )}
                  {importResult.errors.length > 0 && (
                    <Badge variant="destructive" className="text-sm py-1 px-3">{importResult.errors.length} erros</Badge>
                  )}
                </div>

                {errorGroups.length > 0 && (
                  <div className="space-y-1.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <p className="text-xs font-medium text-foreground">Top motivos de falha:</p>
                    <div className="space-y-1">
                      {errorGroups.map((g, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-[11px]">
                          <span className="font-mono text-destructive w-12 text-right">{g.count}×</span>
                          <span className="flex-1 text-muted-foreground truncate" title={g.reason}>{g.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {importResult.errors.length > 0 && (
                  <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-foreground">Linhas com falha (até 20):</p>
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
                <p className="text-sm font-medium text-foreground">Importando contatos… {progress}%</p>
                {progressDetail && <p className="text-xs text-muted-foreground">{progressDetail}</p>}
                <div className="pt-2">
                  <Button variant="outline" size="sm" onClick={() => { cancelRef.current = true; }} className="h-8 text-xs">
                    Cancelar importação
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground/70">Não feche esta janela até a importação concluir.</p>
              </div>
            )}
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
