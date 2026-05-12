/**
 * Utilities for handling Meta WhatsApp template variables.
 *
 * Supports BOTH placeholder formats Meta accepts in approved templates:
 *   - Positional:  {{1}}, {{2}}, {{3}}
 *   - Named:       {{nome}}, {{data}}, {{valor}}
 *
 * Scans HEADER (TEXT format), BODY and BUTTONS (URL sub_type) — not just BODY.
 */

export interface TemplateSlot {
  /** "header" | "body" | "button" */
  component: 'header' | 'body' | 'button';
  /** Button index inside BUTTONS array (only when component === 'button') */
  buttonIndex?: number;
  /** Variable key as it appears between the braces. */
  key: string;
  /** True for named ({{nome}}); false for positional ({{1}}). */
  named: boolean;
  /** Stable id used as React key / Record key. */
  id: string;
  /** Human-friendly label shown next to the input. */
  label: string;
}

const VAR_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

function extractKeys(text: string): { key: string; named: boolean }[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: { key: string; named: boolean }[] = [];
  let m: RegExpExecArray | null;
  VAR_RE.lastIndex = 0;
  while ((m = VAR_RE.exec(text)) !== null) {
    const key = m[1];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, named: !/^\d+$/.test(key) });
  }
  // Positional: sort numerically; named: keep order of appearance
  out.sort((a, b) => {
    if (!a.named && !b.named) return Number(a.key) - Number(b.key);
    return 0;
  });
  return out;
}

/**
 * Returns the ordered list of variable slots for a template.
 * Scans HEADER (text), BODY, and any URL buttons.
 */
export function extractTemplateSlots(components: any[] | null | undefined): TemplateSlot[] {
  if (!Array.isArray(components)) return [];
  const slots: TemplateSlot[] = [];

  for (const c of components) {
    const type = String(c?.type || '').toUpperCase();
    if (type === 'HEADER' && String(c?.format || 'TEXT').toUpperCase() === 'TEXT') {
      for (const k of extractKeys(c.text || '')) {
        slots.push({
          component: 'header',
          key: k.key,
          named: k.named,
          id: `header:${k.key}`,
          label: `Cabeçalho · {{${k.key}}}`,
        });
      }
    } else if (type === 'BODY') {
      for (const k of extractKeys(c.text || '')) {
        slots.push({
          component: 'body',
          key: k.key,
          named: k.named,
          id: `body:${k.key}`,
          label: `Corpo · {{${k.key}}}`,
        });
      }
    } else if (type === 'BUTTONS' && Array.isArray(c.buttons)) {
      c.buttons.forEach((btn: any, idx: number) => {
        const btnType = String(btn?.type || '').toUpperCase();
        if (btnType !== 'URL') return; // só URL aceita variáveis
        for (const k of extractKeys(btn.url || '')) {
          slots.push({
            component: 'button',
            buttonIndex: idx,
            key: k.key,
            named: k.named,
            id: `button:${idx}:${k.key}`,
            label: `Botão ${idx + 1} (URL) · {{${k.key}}}`,
          });
        }
      });
    }
  }

  return slots;
}

/**
 * Builds the `components` array Meta expects, given the slots and the
 * user-provided values keyed by slot.id.
 */
export function buildMetaComponents(
  slots: TemplateSlot[],
  values: Record<string, string>,
): any[] {
  const out: any[] = [];
  const headerSlots = slots.filter(s => s.component === 'header');
  const bodySlots = slots.filter(s => s.component === 'body');
  const buttonGroups = new Map<number, TemplateSlot[]>();
  for (const s of slots.filter(s => s.component === 'button')) {
    const arr = buttonGroups.get(s.buttonIndex!) ?? [];
    arr.push(s);
    buttonGroups.set(s.buttonIndex!, arr);
  }

  const toParam = (s: TemplateSlot) => {
    const text = (values[s.id] ?? '').toString();
    return s.named
      ? { type: 'text', parameter_name: s.key, text }
      : { type: 'text', text };
  };

  if (headerSlots.length > 0) {
    out.push({ type: 'header', parameters: headerSlots.map(toParam) });
  }
  if (bodySlots.length > 0) {
    out.push({ type: 'body', parameters: bodySlots.map(toParam) });
  }
  for (const [idx, group] of buttonGroups) {
    out.push({
      type: 'button',
      sub_type: 'url',
      index: String(idx),
      parameters: group.map(s => ({ type: 'text', text: (values[s.id] ?? '').toString() })),
    });
  }

  return out;
}

/**
 * Renders a preview of the template body with values substituted in.
 * Empty values render as a visible placeholder so the user notices.
 */
export function renderPreview(text: string, valuesByKey: Record<string, string>): string {
  if (!text) return '';
  return text.replace(VAR_RE, (_, key: string) => {
    const v = valuesByKey[key];
    return v && v.length > 0 ? v : `⟨${key}⟩`;
  });
}
