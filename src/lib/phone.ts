// Normalização de telefones brasileiros.
// Mantém paridade com supabase/functions/_shared/phone.ts e a função SQL normalize_brazil_phone.

// DDDs válidos (ANATEL).
const VALID_BR_DDDS = new Set<string>([
  '11','12','13','14','15','16','17','18','19',
  '21','22','24','27','28',
  '31','32','33','34','35','37','38',
  '41','42','43','44','45','46','47','48','49',
  '51','53','54','55',
  '61','62','63','64','65','66','67','68','69',
  '71','73','74','75','77','79',
  '81','82','83','84','85','86','87','88','89',
  '91','92','93','94','95','96','97','98','99',
]);

export function phoneDigitsOnly(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input).replace(/\D/g, '');
}

export function normalizeBrazilPhone(input: unknown): string {
  let d = phoneDigitsOnly(input);
  if (!d) return '';
  // remove zeros à esquerda
  d = d.replace(/^0+/, '');
  if (d.length < 8) return '';

  // Caso 1: 55 + 12 dígitos (DDD 2 + 7 locais sem o 9). Inserir 9 se o 5º dígito (1º do local) ∈ 6..9.
  if (d.length === 12 && d.startsWith('55')) {
    const ddd = d.slice(2, 4);
    const firstLocal = d[4];
    if (VALID_BR_DDDS.has(ddd) && /[6789]/.test(firstLocal)) {
      return '55' + ddd + '9' + d.slice(4);
    }
    return d;
  }

  // Caso já normalizado: 55 + 13 dígitos.
  if (d.length === 13 && d.startsWith('55')) {
    return d;
  }

  // Caso 2: 11 dígitos com DDD válido (sem 55).
  if (d.length === 11) {
    const ddd = d.slice(0, 2);
    if (VALID_BR_DDDS.has(ddd)) return '55' + d;
  }

  // Caso 3: 10 dígitos com DDD válido + local começando 6..9 (sem 9 e sem 55).
  if (d.length === 10) {
    const ddd = d.slice(0, 2);
    const firstLocal = d[2];
    if (VALID_BR_DDDS.has(ddd) && /[6789]/.test(firstLocal)) {
      return '55' + ddd + '9' + d.slice(2);
    }
  }

  // Demais casos (não-BR, números curtos válidos, 12 dígitos sem 55, etc.) — retorna só dígitos.
  return d;
}
