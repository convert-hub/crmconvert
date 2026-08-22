// Espelho de supabase/functions/_shared/secrets.ts para Node (o worker não
// importa .ts). Qualquer mudança lá DEVE ser replicada aqui.
//
// A coluna *_encrypted guarda a referência "vault:<uuid>"; o valor real sai do
// banco só pela RPC reveal_secret (service_role). Valor legado em texto puro
// passa direto, o que permite publicar o worker antes da migration de ativação.

const VAULT_PREFIX = 'vault:';

function isVaultRef(value) {
  return typeof value === 'string' && value.startsWith(VAULT_PREFIX);
}

async function revealSecret(supabase, ref) {
  if (!ref) return '';
  if (!isVaultRef(ref)) return ref;
  const { data, error } = await supabase.rpc('reveal_secret', { _ref: ref });
  if (error) throw new Error(`reveal_secret: ${error.message}`);
  return typeof data === 'string' ? data : '';
}

module.exports = { VAULT_PREFIX, isVaultRef, revealSecret };
