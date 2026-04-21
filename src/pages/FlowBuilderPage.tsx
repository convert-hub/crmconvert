import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Connection,
  MarkerType,
  Panel,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Save, Plus, ArrowLeft, Trash2, MessageSquare, Clock, GitBranch, Zap, Play, UserPlus, Tag, HelpCircle, Shuffle } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import TagPickerSelect from '@/components/contacts/TagPickerSelect';

// ---- Custom Node Component ----
import MessageNode from '@/components/flow-builder/MessageNode';
import MessageNodeEditor from '@/components/flow-builder/MessageNodeEditor';
import ConditionNode from '@/components/flow-builder/ConditionNode';
import DelayNode from '@/components/flow-builder/DelayNode';
import ActionNode from '@/components/flow-builder/ActionNode';
import QuestionNode from '@/components/flow-builder/QuestionNode';
import RandomizerNode from '@/components/flow-builder/RandomizerNode';
import TriggerNode from '@/components/flow-builder/TriggerNode';

const nodeTypes = {
  trigger: TriggerNode,
  message: MessageNode,
  condition: ConditionNode,
  delay: DelayNode,
  action: ActionNode,
  question: QuestionNode,
  randomizer: RandomizerNode,
};

const NODE_PALETTE = [
  { type: 'trigger', label: 'Gatilho', icon: Play, color: 'text-green-500' },
  { type: 'message', label: 'Mensagem', icon: MessageSquare, color: 'text-blue-500' },
  { type: 'condition', label: 'Condição', icon: GitBranch, color: 'text-amber-500' },
  { type: 'delay', label: 'Atraso', icon: Clock, color: 'text-purple-500' },
  { type: 'action', label: 'Ação', icon: Zap, color: 'text-red-500' },
  { type: 'question', label: 'Pergunta', icon: HelpCircle, color: 'text-teal-500' },
  { type: 'randomizer', label: 'Randomizador', icon: Shuffle, color: 'text-cyan-500' },
];

interface FlowRecord {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: any;
  nodes: any[];
  edges: any[];
  is_active: boolean;
  created_at: string;
}

export default function FlowBuilderPage() {
  const { tenant } = useAuth();
  const [flows, setFlows] = useState<FlowRecord[]>([]);
  const [selectedFlow, setSelectedFlow] = useState<FlowRecord | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [flowName, setFlowName] = useState('');
  const [flowDescription, setFlowDescription] = useState('');
  const [flowActive, setFlowActive] = useState(false);
  const [triggerType, setTriggerType] = useState('message_received');
  const [saving, setSaving] = useState(false);
  const [listView, setListView] = useState(true);
  const [nodeEditOpen, setNodeEditOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<Node | null>(null);
  // Tags are now handled by TagPickerSelect component

  // Load flows
  useEffect(() => {
    if (!tenant) return;
    supabase
      .from('chatbot_flows')
      .select('*')
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setFlows((data as unknown as FlowRecord[]) ?? []));
  }, [tenant]);

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) =>
        addEdge({ ...params, markerEnd: { type: MarkerType.ArrowClosed }, animated: true, style: { stroke: 'hsl(var(--primary))' } }, eds)
      ),
    [setEdges]
  );

  const openFlow = (flow: FlowRecord) => {
    setSelectedFlow(flow);
    setFlowName(flow.name);
    setFlowDescription(flow.description ?? '');
    setFlowActive(flow.is_active);
    setTriggerType(flow.trigger_type);
    setNodes((flow.nodes as Node[]) || []);
    setEdges((flow.edges as Edge[]) || []);
    setListView(false);
  };

  const createNewFlow = () => {
    setSelectedFlow(null);
    setFlowName('Novo Fluxo');
    setFlowDescription('');
    setFlowActive(false);
    setTriggerType('message_received');
    const triggerNode: Node = {
      id: 'trigger-1',
      type: 'trigger',
      position: { x: 250, y: 50 },
      data: { label: 'Início', triggerType: 'message_received' },
    };
    setNodes([triggerNode]);
    setEdges([]);
    setListView(false);
  };

  const addNode = (type: string) => {
    const id = `${type}-${Date.now()}`;
    const lastNode = nodes[nodes.length - 1];
    const position = {
      x: (lastNode?.position?.x ?? 250) + (Math.random() * 40 - 20),
      y: (lastNode?.position?.y ?? 0) + 150,
    };

    let data: Record<string, any> = { label: NODE_PALETTE.find(n => n.type === type)?.label ?? type };
    if (type === 'message') data = { ...data, mode: 'text', content: '', templateId: '', templateName: '', templateVariables: {} };
    if (type === 'condition') data = { ...data, field: 'message', operator: 'contains', value: '' };
    if (type === 'delay') data = { ...data, delayMinutes: 5 };
    if (type === 'action') data = { ...data, actionType: 'add_tag', config: {} };
    if (type === 'question') data = { ...data, question: '', saveField: 'name', customFieldKey: '', customFieldLabel: '', validationType: 'none' };
    if (type === 'randomizer') data = { ...data, mode: 'random', options: [{ label: 'Opção A', weight: 50 }, { label: 'Opção B', weight: 50 }] };

    const newNode: Node = { id, type, position, data };
    setNodes((nds) => [...nds, newNode]);
  };

  const handleSave = async () => {
    if (!tenant || !flowName.trim()) return;
    setSaving(true);
    const payload = {
      name: flowName,
      description: flowDescription || null,
      trigger_type: triggerType,
      trigger_config: {},
      nodes: nodes as any,
      edges: edges as any,
      is_active: flowActive,
    };

    try {
      if (selectedFlow) {
        const { error } = await supabase.from('chatbot_flows').update(payload).eq('id', selectedFlow.id);
        if (error) throw error;
        toast.success('Fluxo salvo');
        setFlows(prev => prev.map(f => f.id === selectedFlow.id ? { ...f, ...payload } : f));
      } else {
        const { data, error } = await supabase.from('chatbot_flows').insert({ tenant_id: tenant.id, ...payload }).select().single();
        if (error) throw error;
        toast.success('Fluxo criado');
        setSelectedFlow(data as unknown as FlowRecord);
        setFlows(prev => [data as unknown as FlowRecord, ...prev]);
      }
    } catch (e: any) {
      toast.error(e.message);
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await supabase.from('chatbot_flows').delete().eq('id', id);
    setFlows(prev => prev.filter(f => f.id !== id));
    toast.success('Fluxo removido');
  };

  const onNodeDoubleClick = useCallback((_: any, node: Node) => {
    if (node.type === 'trigger') return;
    setEditingNode(node);
    setNodeEditOpen(true);
  }, []);

  const saveNodeEdit = () => {
    if (!editingNode) return;
    setNodes(nds => nds.map(n => n.id === editingNode.id ? { ...n, data: { ...editingNode.data } } : n));
    setNodeEditOpen(false);
    setEditingNode(null);
  };

  const deleteSelectedNodes = useCallback(() => {
    setNodes(nds => nds.filter(n => !n.selected || n.type === 'trigger'));
    setEdges(eds => {
      const remainingIds = new Set(nodes.filter(n => !n.selected || n.type === 'trigger').map(n => n.id));
      return eds.filter(e => remainingIds.has(e.source) && remainingIds.has(e.target));
    });
  }, [nodes, setNodes, setEdges]);

  // ---- LIST VIEW ----
  if (listView) {
    return (
      <div className="p-6 max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Flow Builder</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Crie fluxos visuais de chatbot e automação</p>
          </div>
          <Button size="sm" onClick={createNewFlow} className="h-9 text-xs">
            <Plus className="h-3.5 w-3.5 mr-1.5" />Novo Fluxo
          </Button>
        </div>

        {flows.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <GitBranch className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Nenhum fluxo criado ainda</p>
            <p className="text-xs mt-1">Crie seu primeiro chatbot ou automação visual</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {flows.map(flow => (
              <div
                key={flow.id}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-4 hover:border-primary/30 transition-colors cursor-pointer"
                onClick={() => openFlow(flow)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-primary shrink-0" />
                    <h3 className="text-sm font-medium truncate">{flow.name}</h3>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${flow.is_active ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'}`}>
                      {flow.is_active ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  {flow.description && <p className="text-xs text-muted-foreground mt-1 truncate">{flow.description}</p>}
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {(flow.nodes as any[])?.length ?? 0} nós · Trigger: {flow.trigger_type}
                  </p>
                </div>
                <Button
                  variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                  onClick={(e) => { e.stopPropagation(); handleDelete(flow.id); }}
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ---- EDITOR VIEW ----
  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2 bg-card shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setListView(true)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Input
          value={flowName}
          onChange={e => setFlowName(e.target.value)}
          className="h-8 text-sm font-medium w-60 border-none bg-transparent focus-visible:ring-1"
        />
        <div className="flex items-center gap-2 ml-auto">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Ativo</Label>
            <Switch checked={flowActive} onCheckedChange={setFlowActive} />
          </div>
          <Button size="sm" onClick={handleSave} disabled={saving} className="h-8 text-xs">
            <Save className="h-3.5 w-3.5 mr-1.5" />{saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Side palette */}
        <div className="w-48 border-r border-border bg-card p-3 space-y-1.5 shrink-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-1 pb-1">Adicionar nó</p>
          {NODE_PALETTE.filter(n => n.type !== 'trigger').map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.type}
                onClick={() => addNode(item.type)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-foreground/80 hover:bg-accent transition-colors"
              >
                <Icon className={`h-4 w-4 ${item.color}`} strokeWidth={1.75} />
                {item.label}
              </button>
            );
          })}

          <div className="pt-3 border-t border-border mt-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-1 pb-1">Gatilho</p>
            <Select value={triggerType} onValueChange={setTriggerType}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="message_received">Mensagem recebida</SelectItem>
                <SelectItem value="lead_created">Lead criado</SelectItem>
                <SelectItem value="tag_added">Tag adicionada</SelectItem>
                <SelectItem value="keyword_match">Palavra-chave</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="pt-3 border-t border-border mt-3">
            <Button variant="outline" size="sm" className="w-full h-8 text-xs" onClick={deleteSelectedNodes}>
              <Trash2 className="h-3 w-3 mr-1.5" />Excluir selecionados
            </Button>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDoubleClick={onNodeDoubleClick}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode="Delete"
            className="bg-background"
          >
            <Background gap={16} size={1} className="opacity-30" />
            <Controls className="!bg-card !border-border !shadow-sm" />
            <MiniMap className="!bg-card !border-border" nodeStrokeWidth={2} pannable zoomable />
          </ReactFlow>
        </div>
      </div>

      {/* Node edit dialog */}
      <Dialog open={nodeEditOpen} onOpenChange={setNodeEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Editar Nó</DialogTitle></DialogHeader>
          {editingNode && (
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Rótulo</Label>
                <Input
                  value={(editingNode.data as any).label ?? ''}
                  onChange={e => setEditingNode({ ...editingNode, data: { ...editingNode.data, label: e.target.value } })}
                  className="h-9 text-sm"
                />
              </div>

              {editingNode.type === 'message' && (
                <MessageNodeEditor
                  tenantId={tenant?.id ?? null}
                  data={editingNode.data as any}
                  onChange={d => setEditingNode({ ...editingNode, data: d })}
                />
              )}

              {editingNode.type === 'condition' && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[11px]">Campo</Label>
                      <Select value={(editingNode.data as any).field ?? 'message'} onValueChange={v => setEditingNode({ ...editingNode, data: { ...editingNode.data, field: v } })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="message">Mensagem</SelectItem>
                          <SelectItem value="contact_name">Nome</SelectItem>
                          <SelectItem value="contact_tag">Tag</SelectItem>
                          <SelectItem value="contact_status">Status</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Operador</Label>
                      <Select value={(editingNode.data as any).operator ?? 'contains'} onValueChange={v => setEditingNode({ ...editingNode, data: { ...editingNode.data, operator: v } })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="contains">Contém</SelectItem>
                          <SelectItem value="equals">Igual</SelectItem>
                          <SelectItem value="starts_with">Começa com</SelectItem>
                          <SelectItem value="not_contains">Não contém</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Valor</Label>
                      <Input
                        value={(editingNode.data as any).value ?? ''}
                        onChange={e => setEditingNode({ ...editingNode, data: { ...editingNode.data, value: e.target.value } })}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                </>
              )}

              {editingNode.type === 'delay' && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Atraso (minutos)</Label>
                  <Input
                    type="number" min={1}
                    value={(editingNode.data as any).delayMinutes ?? 5}
                    onChange={e => setEditingNode({ ...editingNode, data: { ...editingNode.data, delayMinutes: Number(e.target.value) } })}
                    className="h-9 text-sm"
                  />
                </div>
              )}

              {editingNode.type === 'question' && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Texto da pergunta</Label>
                    <Textarea
                      value={(editingNode.data as any).question ?? ''}
                      onChange={e => setEditingNode({ ...editingNode, data: { ...editingNode.data, question: e.target.value } })}
                      rows={3} className="text-sm"
                      placeholder="Ex: Qual é o seu nome completo?"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Salvar resposta em</Label>
                    <Select
                      value={(editingNode.data as any).saveField ?? 'name'}
                      onValueChange={v => setEditingNode({ ...editingNode, data: { ...editingNode.data, saveField: v } })}
                    >
                      <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="name">Nome</SelectItem>
                        <SelectItem value="email">E-mail</SelectItem>
                        <SelectItem value="phone">Telefone</SelectItem>
                        <SelectItem value="city">Cidade</SelectItem>
                        <SelectItem value="state">Estado</SelectItem>
                        <SelectItem value="birth_date">Data de nascimento</SelectItem>
                        <SelectItem value="notes">Observações</SelectItem>
                        <SelectItem value="custom">Campo personalizado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {(editingNode.data as any).saveField === 'custom' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[11px]">Chave do campo</Label>
                        <Input
                          value={(editingNode.data as any).customFieldKey ?? ''}
                          onChange={e => setEditingNode({ ...editingNode, data: { ...editingNode.data, customFieldKey: e.target.value } })}
                          placeholder="ex: cpf"
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px]">Rótulo</Label>
                        <Input
                          value={(editingNode.data as any).customFieldLabel ?? ''}
                          onChange={e => setEditingNode({ ...editingNode, data: { ...editingNode.data, customFieldLabel: e.target.value } })}
                          placeholder="ex: CPF"
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Validação</Label>
                    <Select
                      value={(editingNode.data as any).validationType ?? 'none'}
                      onValueChange={v => setEditingNode({ ...editingNode, data: { ...editingNode.data, validationType: v } })}
                    >
                      <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sem validação</SelectItem>
                        <SelectItem value="email">E-mail válido</SelectItem>
                        <SelectItem value="phone">Telefone válido</SelectItem>
                        <SelectItem value="date">Data válida</SelectItem>
                        <SelectItem value="number">Número</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {editingNode.type === 'randomizer' && (() => {
                const options = ((editingNode.data as any).options || []) as { label: string; weight: number }[];
                const mode = (editingNode.data as any).mode || 'random';
                const totalWeight = options.reduce((s, o) => s + (o.weight || 0), 0);
                const updateOptions = (newOptions: { label: string; weight: number }[]) =>
                  setEditingNode({ ...editingNode, data: { ...editingNode.data, options: newOptions } });

                return (
                  <>
                    <div className="space-y-2">
                      <Label className="text-xs">Tipo de seleção</Label>
                      <RadioGroup
                        value={mode}
                        onValueChange={v => setEditingNode({ ...editingNode, data: { ...editingNode.data, mode: v } })}
                        className="flex gap-4"
                      >
                        <div className="flex items-center gap-1.5">
                          <RadioGroupItem value="random" id="mode-random" />
                          <Label htmlFor="mode-random" className="text-xs font-normal cursor-pointer">Aleatório</Label>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <RadioGroupItem value="sequential" id="mode-sequential" />
                          <Label htmlFor="mode-sequential" className="text-xs font-normal cursor-pointer">Sequencial, um por um</Label>
                        </div>
                      </RadioGroup>
                      {mode === 'random' && (
                        <p className="text-[11px] text-muted-foreground">
                          Indique a probabilidade de escolha da opção. A porcentagem somada deve corresponder 100%.
                        </p>
                      )}
                      {mode === 'sequential' && (
                        <p className="text-[11px] text-muted-foreground">
                          Distribui contatos sequencialmente entre as opções (1→A, 2→B, 3→A...).
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs">Opções</Label>
                      {options.map((opt, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Input
                            value={opt.label}
                            onChange={e => {
                              const newOpts = [...options];
                              newOpts[i] = { ...newOpts[i], label: e.target.value };
                              updateOptions(newOpts);
                            }}
                            placeholder={`Opção ${i + 1}`}
                            className="h-8 text-xs flex-1"
                          />
                          {mode === 'random' && (
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                value={opt.weight}
                                onChange={e => {
                                  const newOpts = [...options];
                                  newOpts[i] = { ...newOpts[i], weight: Number(e.target.value) };
                                  updateOptions(newOpts);
                                }}
                                className="h-8 text-xs w-16"
                              />
                              <span className="text-[11px] text-muted-foreground">%</span>
                            </div>
                          )}
                          {options.length > 2 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              onClick={() => updateOptions(options.filter((_, j) => j !== i))}
                            >
                              <Trash2 className="h-3 w-3 text-muted-foreground" />
                            </Button>
                          )}
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full h-8 text-xs border-dashed"
                        onClick={() => updateOptions([...options, { label: `Opção ${options.length + 1}`, weight: 0 }])}
                      >
                        <Plus className="h-3 w-3 mr-1" />Adicionar opção
                      </Button>
                      {mode === 'random' && totalWeight !== 100 && (
                        <p className="text-[11px] text-destructive flex items-center gap-1">
                          ⚠ A porcentagem somada deve corresponder 100% (atual: {totalWeight}%)
                        </p>
                      )}
                    </div>
                  </>
                );
              })()}

              {editingNode.type === 'action' && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Tipo de ação</Label>
                    <Select value={(editingNode.data as any).actionType ?? 'add_tag'} onValueChange={v => setEditingNode({ ...editingNode, data: { ...editingNode.data, actionType: v, config: {} } })}>
                      <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="add_tag">Adicionar tag</SelectItem>
                        <SelectItem value="remove_tag">Remover tag</SelectItem>
                        <SelectItem value="assign_agent">Atribuir atendente</SelectItem>
                        <SelectItem value="move_stage">Mover etapa</SelectItem>
                        <SelectItem value="send_whatsapp">Enviar WhatsApp</SelectItem>
                        <SelectItem value="close_conversation">Encerrar conversa</SelectItem>
                        <SelectItem value="create_opportunity">Criar oportunidade</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                   {((editingNode.data as any).actionType === 'add_tag' || (editingNode.data as any).actionType === 'remove_tag') && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Tag</Label>
                      <TagPickerSelect
                        value={(editingNode.data as any).config?.tag ?? ''}
                        onChange={v => setEditingNode({ ...editingNode, data: { ...editingNode.data, config: { ...((editingNode.data as any).config || {}), tag: v } } })}
                      />
                    </div>
                  )}

                  {(editingNode.data as any).actionType === 'send_whatsapp' && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Mensagem</Label>
                      <Textarea
                        value={(editingNode.data as any).config?.message ?? ''}
                        onChange={e => setEditingNode({ ...editingNode, data: { ...editingNode.data, config: { ...((editingNode.data as any).config || {}), message: e.target.value } } })}
                        rows={3} className="text-sm"
                        placeholder="Texto da mensagem..."
                      />
                    </div>
                  )}
                </>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setNodeEditOpen(false)}>Cancelar</Button>
                <Button size="sm" onClick={saveNodeEdit}>Salvar</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
