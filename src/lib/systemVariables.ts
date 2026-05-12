/**
 * Registro central de variáveis do sistema.
 * Cada variável declara em quais escopos pode aparecer no picker.
 *
 * Resolução no backend:
 *  - `flow` / `template-meta` / `campaign`: worker/index.js + wa-meta-send/index.ts
 *  - `inbox-composer` / `quick-reply`: ChatPanel.replaceVariables (frontend)
 */
export type VariableScope =
  | 'flow'
  | 'template-meta'
  | 'campaign'
  | 'quick-reply'
  | 'inbox-composer';

export interface SystemVariable {
  /** Conteúdo bruto inserido no campo, sem chaves duplas. Ex.: "contact.name". */
  token: string;
  label: string;
  description?: string;
  group: 'Contato' | 'Oportunidade' | 'Personalizado' | 'Template' | 'Sistema';
  scopes: VariableScope[];
}

/** Variáveis dot-notation resolvidas no worker / edge function de envio. */
export const CONTACT_VARS_DOTTED: SystemVariable[] = [
  { token: 'contact.name', label: 'Nome do contato', group: 'Contato', scopes: ['flow', 'template-meta', 'campaign'] },
  { token: 'contact.email', label: 'E-mail do contato', group: 'Contato', scopes: ['flow', 'template-meta', 'campaign'] },
  { token: 'contact.phone', label: 'Telefone do contato', group: 'Contato', scopes: ['flow', 'template-meta', 'campaign'] },
];

/** Aliases curtos resolvidos no frontend (ChatPanel.replaceVariables). */
export const CONTACT_VARS_SHORT: SystemVariable[] = [
  { token: 'nome', label: 'Nome do contato', group: 'Contato', scopes: ['quick-reply', 'inbox-composer'] },
  { token: 'telefone', label: 'Telefone do contato', group: 'Contato', scopes: ['quick-reply', 'inbox-composer'] },
  { token: 'email', label: 'E-mail do contato', group: 'Contato', scopes: ['quick-reply', 'inbox-composer'] },
];

export const OPPORTUNITY_VARS: SystemVariable[] = [
  { token: 'opportunity.title', label: 'Título da oportunidade', group: 'Oportunidade', scopes: ['flow', 'template-meta', 'campaign'] },
  { token: 'opportunity.value', label: 'Valor da oportunidade', group: 'Oportunidade', scopes: ['flow', 'template-meta', 'campaign'] },
];

export function customFieldVars(
  prefix: 'contact.custom' | 'opportunity.custom',
  keys: string[],
  scopes: VariableScope[],
): SystemVariable[] {
  return keys
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .map((k) => ({
      token: `${prefix}.${k}`,
      label: k,
      group: 'Personalizado',
      description: prefix === 'contact.custom' ? 'Campo personalizado do contato' : 'Campo personalizado da oportunidade',
      scopes,
    }));
}

/** Gera variáveis a partir dos componentes de um template Meta (header/body/buttons). */
export function templateSlotVars(components: any[] | null | undefined): SystemVariable[] {
  if (!Array.isArray(components)) return [];
  const seen = new Set<string>();
  const out: SystemVariable[] = [];
  const re = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
  const scan = (text: string | undefined, where: string) => {
    if (!text) return;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const k = m[1];
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({
        token: k,
        label: /^\d+$/.test(k) ? `Variável ${k}` : k,
        description: `Definida em ${where}`,
        group: 'Template',
        scopes: ['template-meta'],
      });
    }
  };
  for (const c of components) {
    const t = String(c?.type || '').toUpperCase();
    if (t === 'HEADER') scan(c?.text, 'cabeçalho');
    else if (t === 'BODY') scan(c?.text, 'corpo');
    else if (t === 'BUTTONS' && Array.isArray(c?.buttons)) {
      c.buttons.forEach((b: any, i: number) => scan(b?.url, `botão ${i + 1}`));
    }
  }
  return out;
}

export function filterByScope(vars: SystemVariable[], scope: VariableScope): SystemVariable[] {
  return vars.filter((v) => v.scopes.includes(scope));
}
