import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ConversationLinked {
  conversations: number;
  opportunities: number;
  activities: number;
  contactName: string | null;
  contactId: string | null;
  opportunityId: string | null;
}

export interface ContactLinked {
  conversations: number;
  opportunities: number;
  activities: number;
}

export interface OpportunityLinked {
  conversations: number;
  activities: number;
  contactName: string | null;
  contactId: string | null;
}

const MEDIA_BUCKET = "whatsapp-media";

export function useCascadeDelete() {
  const [loading, setLoading] = useState(false);

  // Estes previews alimentam diálogos de EXCLUSÃO. Se uma contagem falhar e
  // virar 0, o usuário subestima o impacto de uma ação irreversível — por isso
  // as falhas são propagadas (o caller aborta a exclusão) em vez de viradas em 0.
  const failIf = (...errs: Array<{ message: string } | null>) => {
    const e = errs.find(Boolean);
    if (e) throw new Error(`Falha ao calcular vínculos: ${e.message}`);
  };

  const getConversationLinked = async (conversationId: string): Promise<ConversationLinked> => {
    const { data: conv, error: convErr } = await supabase
      .from("conversations")
      .select("contact_id, opportunity_id")
      .eq("id", conversationId)
      .single();
    failIf(convErr);

    if (!conv) return { conversations: 0, opportunities: 0, activities: 0, contactName: null, contactId: null, opportunityId: null };

    const result: ConversationLinked = {
      conversations: 0, opportunities: 0, activities: 0,
      contactName: null, contactId: conv.contact_id, opportunityId: conv.opportunity_id,
    };

    if (conv.contact_id) {
      const [convCount, oppCount, contactData] = await Promise.all([
        supabase.from("conversations").select("id", { count: "exact", head: true }).eq("contact_id", conv.contact_id).neq("id", conversationId),
        supabase.from("opportunities").select("id", { count: "exact", head: true }).eq("contact_id", conv.contact_id),
        supabase.from("contacts").select("name").eq("id", conv.contact_id).single(),
      ]);
      failIf(convCount.error, oppCount.error, contactData.error);
      result.conversations = convCount.count || 0;
      result.opportunities = oppCount.count || 0;
      result.contactName = contactData.data?.name || null;
    }

    const { count: actCount, error: actErr } = await supabase
      .from("activities").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId);
    failIf(actErr);
    result.activities = actCount || 0;

    return result;
  };

  const getContactLinked = async (contactId: string): Promise<ContactLinked> => {
    const [convs, opps, acts] = await Promise.all([
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("contact_id", contactId),
      supabase.from("opportunities").select("id", { count: "exact", head: true }).eq("contact_id", contactId),
      supabase.from("activities").select("id", { count: "exact", head: true }).eq("contact_id", contactId),
    ]);
    failIf(convs.error, opps.error, acts.error);
    return {
      conversations: convs.count || 0,
      opportunities: opps.count || 0,
      activities: acts.count || 0,
    };
  };

  const getOpportunityLinked = async (opportunityId: string): Promise<OpportunityLinked> => {
    const { data: opp, error: oppErr } = await supabase
      .from("opportunities").select("contact_id").eq("id", opportunityId).single();
    failIf(oppErr);

    const result: OpportunityLinked = { conversations: 0, activities: 0, contactName: null, contactId: opp?.contact_id || null };

    if (opp?.contact_id) {
      const [convCount, contactData] = await Promise.all([
        supabase.from("conversations").select("id", { count: "exact", head: true }).eq("contact_id", opp.contact_id),
        supabase.from("contacts").select("name").eq("id", opp.contact_id).single(),
      ]);
      failIf(convCount.error, contactData.error);
      result.conversations = convCount.count || 0;
      result.contactName = contactData.data?.name || null;
    }

    const { count: actCount, error: actErr } = await supabase
      .from("activities").select("id", { count: "exact", head: true }).eq("opportunity_id", opportunityId);
    failIf(actErr);
    result.activities = actCount || 0;

    return result;
  };

  // ── Mídia no bucket (LGPD: direito ao esquecimento) ───────────────────
  // Apagar contato/conversa no banco não apagava os áudios, imagens e
  // documentos em whatsapp-media: ficavam órfãos e recuperáveis por signed
  // URL. As linhas de messages somem por ON DELETE CASCADE, então os
  // storage_path precisam ser coletados ANTES da exclusão e removidos DEPOIS
  // que o banco confirmou. Best-effort: uma falha aqui não desfaz a exclusão
  // (os dados já se foram), mas é reportada ao usuário.
  const conversationIdsOfContact = async (contactId: string): Promise<string[]> => {
    const { data, error } = await supabase.from("conversations").select("id").eq("contact_id", contactId);
    if (error) throw new Error(`Falha ao listar conversas do contato: ${error.message}`);
    return (data ?? []).map(c => c.id);
  };

  const collectMediaPaths = async (conversationIds: string[]): Promise<string[]> => {
    const paths: string[] = [];
    for (let i = 0; i < conversationIds.length; i += 200) {
      const ids = conversationIds.slice(i, i + 200);
      let from = 0;
      for (;;) {
        const { data, error } = await supabase
          .from("messages")
          .select("storage_path")
          .in("conversation_id", ids)
          .not("storage_path", "is", null)
          .range(from, from + 999);
        if (error) throw new Error(`Falha ao listar mídias: ${error.message}`);
        const rows = data ?? [];
        for (const m of rows) if (m.storage_path) paths.push(m.storage_path);
        if (rows.length < 1000) break;
        from += 1000;
      }
    }
    return paths;
  };

  const removeMediaPaths = async (paths: string[]) => {
    if (paths.length === 0) return;
    let failed = 0;
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error } = await supabase.storage.from(MEDIA_BUCKET).remove(chunk);
      if (error) failed += chunk.length;
    }
    if (failed > 0) toast.warning(`${failed} arquivo(s) de mídia não puderam ser removidos do armazenamento.`);
  };

  const deleteConversationCascade = async (conversationId: string, contactId: string | null, alsoDelete: string[]) => {
    setLoading(true);
    try {
      const wholeContact = contactId && (alsoDelete.includes("contact") || alsoDelete.includes("conversations"));
      const mediaPaths = await collectMediaPaths(
        wholeContact ? await conversationIdsOfContact(contactId) : [conversationId],
      );

      if (alsoDelete.includes("activities")) {
        await supabase.from("activities").delete().eq("conversation_id", conversationId);
      }

      const { error } = await supabase.from("conversations").delete().eq("id", conversationId);
      if (error) throw error;

      if (alsoDelete.includes("contact") && contactId) {
        // Delete everything for this contact
        await supabase.from("activities").delete().eq("contact_id", contactId);
        await supabase.from("conversations").delete().eq("contact_id", contactId);
        await supabase.from("opportunities").delete().eq("contact_id", contactId);
        const { error: contactError } = await supabase.from("contacts").delete().eq("id", contactId);
        if (contactError) throw contactError;
      } else {
        if (alsoDelete.includes("opportunities") && contactId) {
          await supabase.from("opportunities").delete().eq("contact_id", contactId);
        }
        if (alsoDelete.includes("conversations") && contactId) {
          await supabase.from("conversations").delete().eq("contact_id", contactId);
        }
      }

      await removeMediaPaths(mediaPaths);
      toast.success("Exclusão concluída");
      return true;
    } catch (err: any) {
      toast.error(`Erro ao excluir: ${err.message}`);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const deleteContactCascade = async (contactId: string, alsoDelete: string[]) => {
    setLoading(true);
    try {
      // Só quando as conversas vão junto: se ficam (desvinculadas), a mídia fica.
      const mediaPaths = alsoDelete.includes("conversations")
        ? await collectMediaPaths(await conversationIdsOfContact(contactId))
        : [];

      if (alsoDelete.includes("activities")) {
        await supabase.from("activities").delete().eq("contact_id", contactId);
      }
      if (alsoDelete.includes("conversations")) {
        await supabase.from("conversations").delete().eq("contact_id", contactId);
      }
      if (alsoDelete.includes("opportunities")) {
        await supabase.from("opportunities").delete().eq("contact_id", contactId);
      }

      // Desvincular conversas restantes
      await supabase.from("conversations").update({ contact_id: null }).eq("contact_id", contactId);
      // Desvincular oportunidades restantes
      await supabase.from("opportunities").update({ contact_id: null }).eq("contact_id", contactId);

      const { error } = await supabase.from("contacts").delete().eq("id", contactId);
      if (error) throw error;

      await removeMediaPaths(mediaPaths);
      toast.success("Contato excluído");
      return true;
    } catch (err: any) {
      toast.error(`Erro ao excluir contato: ${err.message}`);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const deleteOpportunityCascade = async (opportunityId: string, contactId: string | null, alsoDelete: string[]) => {
    setLoading(true);
    try {
      const mediaPaths = contactId && (alsoDelete.includes("contact") || alsoDelete.includes("conversations"))
        ? await collectMediaPaths(await conversationIdsOfContact(contactId))
        : [];

      if (alsoDelete.includes("activities")) {
        await supabase.from("activities").delete().eq("opportunity_id", opportunityId);
      }

      const { error } = await supabase.from("opportunities").delete().eq("id", opportunityId);
      if (error) throw error;

      if (alsoDelete.includes("contact") && contactId) {
        await supabase.from("activities").delete().eq("contact_id", contactId);
        await supabase.from("conversations").delete().eq("contact_id", contactId);
        await supabase.from("opportunities").delete().eq("contact_id", contactId);
        const { error: contactError } = await supabase.from("contacts").delete().eq("id", contactId);
        if (contactError) throw contactError;
      } else if (alsoDelete.includes("conversations") && contactId) {
        await supabase.from("conversations").delete().eq("contact_id", contactId);
      }

      await removeMediaPaths(mediaPaths);
      toast.success("Oportunidade excluída");
      return true;
    } catch (err: any) {
      toast.error(`Erro ao excluir: ${err.message}`);
      return false;
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    getConversationLinked,
    getContactLinked,
    getOpportunityLinked,
    deleteConversationCascade,
    deleteContactCascade,
    deleteOpportunityCascade,
  };
}
