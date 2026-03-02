import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Upload, FileText, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ImportContactsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  onImported: () => void;
}

type CsvRow = Record<string, string>;

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

function guessMapping(header: string): string {
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
  return 'skip';
}

function parseCSV(text: string): { headers: string[]; rows: CsvRow[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  // Detect delimiter
  const firstLine = lines[0];
  const delimiter = firstLine.includes(';') ? ';' : ',';

  const headers = firstLine.split(delimiter).map(h => h.replace(/^"|"$/g, '').trim());
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(delimiter).map(v => v.replace(/^"|"$/g, '').trim());
    const row: CsvRow = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
    rows.push(row);
  }

  return { headers, rows };
}

function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);
  if (cleaned.length === 10 || cleaned.length === 11) cleaned = '55' + cleaned;
  if (cleaned && !cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

export default function ImportContactsDialog({ open, onOpenChange, tenantId, onImported }: ImportContactsDialogProps) {
  const [step, setStep] = useState<'upload' | 'mapping' | 'importing'>('upload');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importResult, setImportResult] = useState<{ created: number; updated: number; errors: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { headers: h, rows: r } = parseCSV(text);
      if (h.length === 0) { toast.error('CSV inválido'); return; }
      setHeaders(h);
      setRows(r);
      const autoMapping: Record<string, string> = {};
      h.forEach(header => { autoMapping[header] = guessMapping(header); });
      setMapping(autoMapping);
      setStep('mapping');
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleImport = async () => {
    const nameCol = Object.entries(mapping).find(([, v]) => v === 'name')?.[0];
    if (!nameCol) { toast.error('Mapeie pelo menos a coluna "Nome"'); return; }

    setStep('importing');
    let created = 0, updated = 0, errors = 0;
    const BATCH = 50;

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const contacts = batch.map(row => {
        const c: any = { tenant_id: tenantId };
        Object.entries(mapping).forEach(([csvCol, field]) => {
          if (field === 'skip' || !row[csvCol]) return;
          if (field === 'phone') c.phone = normalizePhone(row[csvCol]);
          else if (field === 'tags') c.tags = row[csvCol].split(/[;,]/).map((t: string) => t.trim()).filter(Boolean);
          else c[field] = row[csvCol];
        });
        if (!c.name) c.name = 'Sem nome';
        if (!c.status) c.status = 'lead';
        return c;
      });

      // Deduplicate by phone/email - upsert logic
      for (const contact of contacts) {
        try {
          let existing: any = null;
          if (contact.phone) {
            const { data } = await supabase.from('contacts').select('id').eq('tenant_id', tenantId).eq('phone', contact.phone).limit(1);
            if (data && data.length > 0) existing = data[0];
          }
          if (!existing && contact.email) {
            const { data } = await supabase.from('contacts').select('id').eq('tenant_id', tenantId).eq('email', contact.email).limit(1);
            if (data && data.length > 0) existing = data[0];
          }

          if (existing) {
            const { tenant_id, ...updateData } = contact;
            await supabase.from('contacts').update(updateData).eq('id', existing.id);
            updated++;
          } else {
            await supabase.from('contacts').insert(contact);
            created++;
          }
        } catch {
          errors++;
        }
      }
    }

    setImportResult({ created, updated, errors });
    toast.success(`Importação concluída: ${created} criados, ${updated} atualizados`);
    onImported();
  };

  const reset = () => {
    setStep('upload');
    setHeaders([]);
    setRows([]);
    setMapping({});
    setImportResult(null);
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
              <p className="text-xs text-muted-foreground mt-1">Suporta delimitadores vírgula (,) e ponto-e-vírgula (;)</p>
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
                      <TableHead key={h} className="text-[11px]">{mapping[h]}</TableHead>
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
          <div className="py-8 text-center space-y-4">
            {importResult ? (
              <>
                <p className="text-lg font-semibold text-foreground">Importação concluída!</p>
                <div className="flex justify-center gap-4">
                  <Badge variant="outline" className="text-sm py-1 px-3">{importResult.created} criados</Badge>
                  <Badge variant="outline" className="text-sm py-1 px-3">{importResult.updated} atualizados</Badge>
                  {importResult.errors > 0 && <Badge variant="destructive" className="text-sm py-1 px-3">{importResult.errors} erros</Badge>}
                </div>
                <Button onClick={() => handleClose(false)}>Fechar</Button>
              </>
            ) : (
              <>
                <div className="h-8 w-8 mx-auto border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-muted-foreground">Importando contatos...</p>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
