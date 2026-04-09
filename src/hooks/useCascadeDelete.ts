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

export function useCascadeDelete() {
  const [loading, setLoading] = useState(false);

  const getConversationLinked = async (conversationId: string): Promise<ConversationLinked> => {
    const { data: conv } = await supabase
      .from("conversations")
      .select("contact_id, opportunity_id")
      .eq("id", conversationId)
      .single();

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
      result.conversations = convCount.count || 0;
      result.opportunities = oppCount.count || 0;
      result.contactName = contactData.data?.name || null;
    }

    const { count: actCount } = await supabase
      .from("activities").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId);
    result.activities = actCount || 0;

    return result;
  };

  const getContactLinked = async (contactId: string): Promise<ContactLinked> => {
    const [convs, opps, acts] = await Promise.all([
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("contact_id", contactId),
      supabase.from("opportunities").select("id", { count: "exact", head: true }).eq("contact_id", contactId),
      supabase.from("activities").select("id", { count: "exact", head: true }).eq("contact_id", contactId),
    ]);
    return {
      conversations: convs.count || 0,
      opportunities: opps.count || 0,
      activities: acts.count || 0,
    };
  };

  const getOpportunityLinked = async (opportunityId: string): Promise<OpportunityLinked> => {
    const { data: opp } = await supabase
      .from("opportunities").select("contact_id").eq("id", opportunityId).single();

    const result: OpportunityLinked = { conversations: 0, activities: 0, contactName: null, contactId: opp?.contact_id || null };

    if (opp?.contact_id) {
      const [convCount, contactData] = await Promise.all([
        supabase.from("conversations").select("id", { count: "exact", head: true }).eq("contact_id", opp.contact_id),
        supabase.from("contacts").select("name").eq("id", opp.contact_id).single(),
      ]);
      result.conversations = convCount.count || 0;
      result.contactName = contactData.data?.name || null;
    }

    const { count: actCount } = await supabase
      .from("activities").select("id", { count: "exact", head: true }).eq("opportunity_id", opportunityId);
    result.activities = actCount || 0;

    return result;
  };

  const deleteConversationCascade = async (conversationId: string, contactId: string | null, alsoDelete: string[]) => {
    setLoading(true);
    try {
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
