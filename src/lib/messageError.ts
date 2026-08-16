/**
 * Texto de falha de envio exibido ao atendente.
 *
 * O que fica gravado em `provider_metadata.error_message` nem sempre serve para
 * leitura humana: registros antigos guardaram valores como "true" (booleano
 * stringificado, antes da normalização de 06/07) e a mensagem genérica do SDK
 * "Edge Function returned a non-2xx status code", que não diz nada sobre a
 * causa. Nesses casos é melhor mostrar um texto claro do que expor o lixo.
 */

// Valores que não têm significado para quem lê
const USELESS = new Set(['true', 'false', 'null', 'undefined', 'nan', '[object object]', '{}', '[]', 'error', 'unknown_error']);

export function humanizeSendError(raw: unknown, fallback = 'Falha no envio via WhatsApp'): string {
  if (typeof raw !== 'string') return fallback;
  const text = raw.trim();
  if (!text) return fallback;
  if (USELESS.has(text.toLowerCase())) return fallback;
  // Genérica do supabase-js quando a edge function responde não-2xx
  if (/non-2xx status code/i.test(text)) return fallback;
  return text;
}
