import type { Node, Edge } from '@xyflow/react';

export interface FlowIssue {
  level: 'error' | 'warning';
  nodeId?: string;
  message: string;
}

const nodeName = (n: Node) => {
  const label = (n.data as any)?.label;
  const typeLabel: Record<string, string> = {
    trigger: 'Gatilho', message: 'Mensagem', menu: 'Menu', condition: 'Condição',
    delay: 'Atraso', action: 'Ação', question: 'Pergunta', randomizer: 'Randomizador',
    aiassistant: 'Assistente IA', subflow: 'Conectar fluxo',
  };
  const base = typeLabel[n.type ?? ''] ?? n.type ?? 'Bloco';
  return label && label !== base ? `${base} "${label}"` : base;
};

export interface ValidateOpts {
  triggerType?: string;
  whatsappInstanceId?: string | null;
}

// Erros impedem ativar o fluxo; avisos apenas informam.
export function validateFlow(nodes: Node[], edges: Edge[], opts: ValidateOpts = {}): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const err = (message: string, nodeId?: string) => issues.push({ level: 'error', message, nodeId });
  const warn = (message: string, nodeId?: string) => issues.push({ level: 'warning', message, nodeId });

  // Gatilhos que disparam sem conversa aberta precisam de um número de envio
  // para as mensagens terem por onde sair.
  const firesWithoutConversation = ['tag_added', 'lead_created', 'webhook'].includes(opts.triggerType ?? '');
  const sendsMessages = nodes.some(n => ['message', 'question', 'menu', 'aiassistant'].includes(n.type ?? ''));
  if (firesWithoutConversation && sendsMessages && !opts.whatsappInstanceId) {
    warn('Este gatilho pode disparar sem conversa aberta. Defina o "Número de envio" para as mensagens serem entregues.');
  }

  const trigger = nodes.find(n => n.type === 'trigger');
  if (!trigger) {
    err('O fluxo não tem o bloco de Gatilho (Início). Sem ele, o fluxo nunca dispara.');
  } else if (nodes.length > 1 && !edges.some(e => e.source === trigger.id)) {
    err('O Gatilho não está conectado a nenhum bloco. O fluxo dispara e para na hora.', trigger.id);
  }

  for (const n of nodes) {
    const d: any = n.data ?? {};
    const name = nodeName(n);

    if (n.type === 'message') {
      const mode = d.mode || 'text';
      if (mode === 'text' && !String(d.content ?? '').trim()) {
        err(`${name}: o texto da mensagem está vazio.`, n.id);
      }
      if (mode === 'template' && !d.templateId) {
        err(`${name}: nenhum template selecionado.`, n.id);
      }
      if (mode === 'items') {
        const items: any[] = Array.isArray(d.items) ? d.items : [];
        const hasContent = items.some(it =>
          it?.kind === 'text' ? String(it.content ?? '').trim() : String(it?.url ?? '').trim());
        if (!hasContent) err(`${name}: nenhum conteúdo adicionado.`, n.id);
      }
    }

    if (n.type === 'question') {
      if (!String(d.question ?? '').trim()) err(`${name}: o texto da pergunta está vazio.`, n.id);
      if (d.saveField === 'custom' && !String(d.customFieldKey ?? '').trim()) {
        err(`${name}: campo personalizado sem chave definida.`, n.id);
      }
    }

    if (n.type === 'menu') {
      if (!String(d.question ?? '').trim()) err(`${name}: o texto do menu está vazio.`, n.id);
      if (d.saveField === 'custom' && !String(d.customFieldKey ?? '').trim()) {
        err(`${name}: campo personalizado sem chave definida.`, n.id);
      }
      const options: any[] = Array.isArray(d.options) ? d.options : [];
      if (options.length === 0) err(`${name}: o menu não tem opções.`, n.id);
      options.forEach((opt, i) => {
        if (!String(opt?.label ?? '').trim()) err(`${name}: a opção ${i + 1} está sem texto.`, n.id);
        const handle = `option-${opt?.id}`;
        if (opt?.id && !edges.some(e => e.source === n.id && e.sourceHandle === handle)) {
          warn(`${name}: a opção "${opt.label || i + 1}" não leva a nenhum bloco (quem escolher ela fica sem resposta).`, n.id);
        }
      });
    }

    if (n.type === 'condition') {
      const criteria: any[] = Array.isArray(d.criteria) && d.criteria.length > 0
        ? d.criteria
        : [{ field: d.field ?? 'message', operator: d.operator ?? 'contains', value: d.value ?? '' }];
      criteria.forEach((c) => {
        const noValueNeeded = c.operator === 'exists' || c.operator === 'not_exists';
        if (!noValueNeeded && !String(c.value ?? '').trim()) {
          err(`${name}: critério sem valor para comparar.`, n.id);
        }
      });
      const hasYes = edges.some(e => e.source === n.id && (e.sourceHandle === 'yes' || !e.sourceHandle));
      const hasNo = edges.some(e => e.source === n.id && e.sourceHandle === 'no');
      if (!hasYes) warn(`${name}: a saída "Sim" não está conectada (quem atender a condição para ali).`, n.id);
      if (!hasNo) warn(`${name}: a saída "Não" não está conectada (quem não atender a condição para ali).`, n.id);
    }

    if (n.type === 'randomizer') {
      const options: any[] = Array.isArray(d.options) ? d.options : [];
      if (options.length === 0) err(`${name}: nenhuma opção configurada.`, n.id);
      if ((d.mode || 'random') === 'random') {
        const total = options.reduce((s, o) => s + (Number(o?.weight) || 0), 0);
        if (options.length > 0 && total !== 100) {
          err(`${name}: as porcentagens somam ${total}% (precisam somar 100%).`, n.id);
        }
      }
      options.forEach((opt, i) => {
        const handles = [opt?.id ? `opt-${opt.id}` : null, `option-${i}`].filter(Boolean) as string[];
        const connected = edges.some(e => e.source === n.id && handles.includes(e.sourceHandle ?? ''));
        if (!connected) {
          warn(`${name}: a saída "${opt?.label || `Opção ${i + 1}`}" não leva a nenhum bloco.`, n.id);
        }
      });
    }

    if (n.type === 'subflow' && !d.targetFlowId) {
      err(`${name}: nenhum fluxo de destino selecionado.`, n.id);
    }

    if (n.type === 'aiassistant' && !String(d.prompt ?? '').trim()) {
      err(`${name}: o prompt está vazio.`, n.id);
    }

    if (n.type === 'action') {
      const actions: any[] = Array.isArray(d.actions) && d.actions.length > 0
        ? d.actions
        : (d.actionType ? [{ type: d.actionType, config: d.config }] : []);
      if (actions.length === 0) warn(`${name}: nenhuma ação configurada (o bloco não faz nada).`, n.id);
    }

    if (n.type === 'delay') {
      const mins = Number(d.delayMinutes) || 0;
      if (mins > 1) {
        warn(`${name}: atrasos acima de 1 minuto ainda não são suportados pelo motor — o fluxo segue sem esperar.`, n.id);
      }
    }
  }

  // Blocos inalcançáveis a partir do Gatilho nunca executam.
  if (trigger) {
    const adjacency = new Map<string, string[]>();
    for (const e of edges) {
      const list = adjacency.get(e.source) ?? [];
      list.push(e.target);
      adjacency.set(e.source, list);
    }
    const reachable = new Set<string>([trigger.id]);
    const stack = [trigger.id];
    while (stack.length) {
      const id = stack.pop()!;
      for (const next of adjacency.get(id) ?? []) {
        if (!reachable.has(next)) { reachable.add(next); stack.push(next); }
      }
    }
    for (const n of nodes) {
      if (!reachable.has(n.id)) {
        warn(`${nodeName(n)}: está desconectado do fluxo e nunca será executado.`, n.id);
      }
    }
  }

  return issues;
}
