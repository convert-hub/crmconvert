// Portuguese labels for enum values displayed in the UI

export const conversationStatusLabels: Record<string, string> = {
  open: 'Aberta',
  waiting_customer: 'Aguardando Cliente',
  waiting_agent: 'Aguardando Agente',
  closed: 'Fechada',
};

export const contactStatusLabels: Record<string, string> = {
  lead: 'Lead',
  customer: 'Cliente',
  churned: 'Perdido',
  inactive: 'Inativo',
};

export const opportunityStatusLabels: Record<string, string> = {
  open: 'Aberta',
  won: 'Ganha',
  lost: 'Perdida',
};

export const priorityLabels: Record<string, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  urgent: 'Urgente',
};

export const channelLabels: Record<string, string> = {
  whatsapp: 'WhatsApp',
  email: 'Email',
  phone: 'Telefone',
  web: 'Web',
  facebook: 'Facebook',
};
