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

// Cache em memória — definições raramente mudam, mas TTL curto evita prender
// chaves recém-criadas em Configurações por muito tempo.
type CustomDef = { key: string; label?: string };
const cache = new Map<string, { contact: CustomDef[]; opportunity: CustomDef[]; ts: number }>();
const CACHE_MS = 30 * 1000;

async function discoverCustomKeys(tenantId: string) {
  const cached = cache.get(tenantId);
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached;

  // Fonte oficial: definições salvas em tenants.settings pelo painel de Configurações.
  const { data: t } = await supabase.from('tenants').select('settings').eq('id', tenantId).single();
  const settings = (t?.settings && typeof t.settings === 'object' && !Array.isArray(t.settings))
    ? (t.settings as Record<string, any>) : {};

  const normalize = (arr: any): CustomDef[] => Array.isArray(arr)
    ? arr.filter((f) => f && typeof f.key === 'string').map((f) => ({ key: f.key, label: f.label }))
    : [];

  const value = {
    contact: normalize(settings.custom_contact_fields),
    opportunity: normalize(settings.custom_opportunity_fields),
    ts: Date.now(),
  };
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
  const [custom, setCustom] = useState<{ contact: CustomDef[]; opportunity: CustomDef[] }>({ contact: [], opportunity: [] });

  useEffect(() => {
    if (!tenantId) return;
    let alive = true;
    discoverCustomKeys(tenantId).then((v) => { if (alive) setCustom({ contact: v.contact, opportunity: v.opportunity }); });
    return () => { alive = false; };
  }, [tenantId]);

  return useMemo<SystemVariable[]>(() => {
    const all: SystemVariable[] = [];
    const contactKeys = custom.contact.map((d) => d.key);
    const oppKeys = custom.opportunity.map((d) => d.key);

    if (scope === 'template-meta') {
      all.push(...templateSlotVars(templateComponents));
      all.push(...CONTACT_VARS_DOTTED);
      all.push(...customFieldVars('contact.custom', contactKeys, ['template-meta']));
      all.push(...customFieldVars('opportunity.custom', oppKeys, ['template-meta']));
    } else if (scope === 'inbox-composer' || scope === 'quick-reply') {
      all.push(...CONTACT_VARS_SHORT);
      all.push(...customFieldVars('contact.custom', contactKeys, [scope]));
    } else {
      // flow / campaign
      all.push(...CONTACT_VARS_DOTTED);
      all.push(...OPPORTUNITY_VARS);
      all.push(...customFieldVars('contact.custom', contactKeys, [scope]));
      all.push(...customFieldVars('opportunity.custom', oppKeys, [scope]));
    }
    return filterByScope(all, scope);
  }, [scope, templateComponents, custom]);
}
