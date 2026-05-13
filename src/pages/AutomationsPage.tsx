import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useState } from 'react';
import KeywordsTab from '@/components/automations/KeywordsTab';
import WebhooksTab from '@/components/automations/WebhooksTab';
import SequencesTab from '@/components/automations/SequencesTab';
import RulesTab from '@/components/automations/RulesTab';

export default function AutomationsPage() {
  const [tab, setTab] = useState('keywords');

  return (
    <div className="p-6 max-w-6xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Automações</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Palavras-chave, webhooks, sequências de mensagens e regras por evento.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="h-9">
          <TabsTrigger value="keywords" className="text-xs px-3">Palavras-chave</TabsTrigger>
          <TabsTrigger value="sequences" className="text-xs px-3">Sequências</TabsTrigger>
          <TabsTrigger value="webhooks" className="text-xs px-3">Webhooks</TabsTrigger>
          <TabsTrigger value="rules" className="text-xs px-3">Regras</TabsTrigger>
        </TabsList>

        <TabsContent value="keywords"><KeywordsTab /></TabsContent>
        <TabsContent value="sequences"><SequencesTab /></TabsContent>
        <TabsContent value="webhooks"><WebhooksTab /></TabsContent>
        <TabsContent value="rules"><RulesTab /></TabsContent>
      </Tabs>
    </div>
  );
}
