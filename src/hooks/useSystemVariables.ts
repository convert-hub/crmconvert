import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  CONTACT_VARS_DOTTED,
  CONTACT_VARS_SHORT,
  OPPORTUNITY_VARS,
  customFieldVars,
  templateSlotVars,
  filterByScope,
  type SystemVariable,
  type VariableScope,
} from '@/lib/systemVariables';

// Cache em memória — chaves de custom_fields raramente mudam dentro da sessão.
const cache = new Map<string, { contact: string[]; opportunity: string[]; ts: number }>();
const CACHE_MS = 5 * 60 * 1000;

async function discoverCustomKeys(tenantId: string) {
  const cached = cache.get(tenantId);
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached;

  const [{ data: cs }, { data: os }] = await Promise.all([
    supabase.from('contacts').select('custom_fields').eq('tenant_id', tenantId).neq('custom_fields', '{}').limit(500),
    supabase.from('opportunities').select('custom_fields').eq('tenant_id', tenantId).neq('custom_fields', '{}').limit(500),
  ]);

  const collect = (rows: any[] | null) => {
    const set = new Set<string>();
    (rows ?? []).forEach((r) => {
      const cf = r?.custom_fields;
      if (cf && typeof cf === 'object') Object.keys(cf).forEach((k) => set.add(k));
    });
    return [...set];
  };
  const value = { contact: collect(cs), opportunity: collect(os), ts: Date.now() };
  cache.set(tenantId, value);
  return value;
}

interface Args {
  tenantId: string | null;
  scope: VariableScope;
  /** Componentes do template Meta selecionado (para escopo template-meta). */
  templateComponents?: any[] | null;
}

export function useSystemVariables({ tenantId, scope, templateComponents }: Args) {
  const [custom, setCustom] = useState<{ contact: string[]; opportunity: string[] }>({ contact: [], opportunity: [] });

  useEffect(() => {
    if (!tenantId) return;
    let alive = true;
    discoverCustomKeys(tenantId).then((v) => { if (alive) setCustom({ contact: v.contact, opportunity: v.opportunity }); });
    return () => { alive = false; };
  }, [tenantId]);

  return useMemo<SystemVariable[]>(() => {
    const all: SystemVariable[] = [];
    if (scope === 'template-meta') {
      // Template Meta usa apenas slots declarados no template + nomeados via {{contact.*}} (interpolados pelo wa-meta-send.interp)
      all.push(...templateSlotVars(templateComponents));
      all.push(...CONTACT_VARS_DOTTED);
      all.push(...customFieldVars('contact.custom', custom.contact, ['template-meta']));
    } else if (scope === 'inbox-composer' || scope === 'quick-reply') {
      all.push(...CONTACT_VARS_SHORT);
      all.push(...customFieldVars('contact.custom', custom.contact, [scope]));
    } else {
      // flow / campaign — escopos onde o worker resolve dot-notation
      all.push(...CONTACT_VARS_DOTTED);
      all.push(...OPPORTUNITY_VARS);
      all.push(...customFieldVars('contact.custom', custom.contact, [scope]));
      all.push(...customFieldVars('opportunity.custom', custom.opportunity, [scope]));
    }
    return filterByScope(all, scope);
  }, [scope, templateComponents, custom]);
}
