// Segredos de integração (tokens UAZAPI/Meta, chaves OpenAI) vivem no Supabase
// Vault. A coluna *_encrypted da tabela guarda só a referência "vault:<uuid>";
// o valor real sai do banco apenas pela RPC reveal_secret, restrita a
// service_role (migration 20260822120000_vault_segredos_infra.sql).
//
// Valor legado em texto puro (anterior à migration de ativação) passa direto:
// isso permite publicar as functions ANTES da ativação sem quebrar nada.
// Espelho em Node: worker/lib/secrets.js — qualquer mudança aqui vai lá também.

export const VAULT_PREFIX = 'vault:';

export function isVaultRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(VAULT_PREFIX);
}

// `supabase` precisa ser o client de service_role: reveal_secret nega anon/authenticated.
export async function revealSecret(supabase: any, ref: string | null | undefined): Promise<string> {
  if (!ref) return '';
  if (!isVaultRef(ref)) return ref;
  const { data, error } = await supabase.rpc('reveal_secret', { _ref: ref });
  if (error) throw new Error(`reveal_secret: ${error.message}`);
  return typeof data === 'string' ? data : '';
}

// Comparação em tempo constante: não revela, pelo tempo de resposta, quantos
// caracteres do segredo bateram.
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
