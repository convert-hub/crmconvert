import { useEffect } from 'react';
import { toast } from 'sonner';

/**
 * Auto-atualização do frontend. Problema que resolve: após cada rebuild, os
 * atendentes continuavam com o bundle ANTIGO em cache até um Ctrl+Shift+R que
 * ninguém fazia — correções "não chegavam" (semanas rodando versão velha).
 *
 * Como funciona: a cada 5 min (e ao voltar para a aba) busca o index.html
 * direto do servidor (cache: no-store) e compara o hash do bundle com o que
 * está rodando. Se mudou:
 *  - aba em segundo plano → recarrega na hora, silenciosamente;
 *  - aba visível → aviso com botão "Atualizar agora" (não interrompe quem
 *    está digitando).
 */
const CHECK_MS = 5 * 60 * 1000;
const ASSET_RE = /assets\/index-([\w-]+)\.js/;

function currentBundleHash(): string | null {
  const script = document.querySelector<HTMLScriptElement>('script[src*="assets/index-"]');
  const m = script?.src.match(ASSET_RE);
  return m?.[1] ?? null;
}

export function useAutoUpdate() {
  useEffect(() => {
    const mine = currentBundleHash();
    if (!mine) return; // dev server (sem bundle hasheado)

    let notified = false;

    const check = async () => {
      if (notified) return;
      try {
        const res = await fetch('/', { cache: 'no-store', headers: { Accept: 'text/html' } });
        if (!res.ok) return;
        const html = await res.text();
        const m = html.match(ASSET_RE);
        if (!m || !m[1] || m[1] === mine) return;

        if (document.hidden) {
          window.location.reload();
          return;
        }
        notified = true;
        toast.info('Nova versão do CRM disponível', {
          description: 'Atualize para receber as últimas correções.',
          duration: Infinity,
          action: { label: 'Atualizar agora', onClick: () => window.location.reload() },
        });
      } catch {
        // offline/erro de rede: tenta de novo no próximo ciclo
      }
    };

    const iv = setInterval(check, CHECK_MS);
    const onVisibility = () => { if (!document.hidden) check(); };
    document.addEventListener('visibilitychange', onVisibility);
    const first = setTimeout(check, 30_000);
    return () => {
      clearInterval(iv);
      clearTimeout(first);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
}
