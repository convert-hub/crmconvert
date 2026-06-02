# Habilitar cross-origin isolation para ffmpeg.wasm (COEP: credentialless)

Diagnóstico: ffmpeg-core.js + .wasm baixam com 200, mas `ffmpeg.load()` falha porque `SharedArrayBuffer` é `undefined`. Browsers só expõem SAB quando a página está em estado `crossOriginIsolated`, o que exige COOP `same-origin` + COEP. Usar `credentialless` (em vez de `require-corp`) ativa o isolation sem exigir que recursos cross-origin enviem CORP — crítico porque Supabase Storage não emite CORP nas signed URLs.

## 1. `nginx.conf` — COOP + COEP credentialless + MIME wasm

```
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # default mime.types do nginx não inclui wasm → browser recusa instanciar WebAssembly
    types {
        application/wasm wasm;
    }

    add_header Cross-Origin-Embedder-Policy "credentialless" always;
    add_header Cross-Origin-Opener-Policy   "same-origin"    always;

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cross-Origin-Embedder-Policy "credentialless" always;
        add_header Cross-Origin-Opener-Policy   "same-origin"    always;
    }

    location ~* \.(js|css|wasm|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        add_header Cross-Origin-Embedder-Policy "credentialless" always;
        add_header Cross-Origin-Opener-Policy   "same-origin"    always;
        add_header Cross-Origin-Resource-Policy "same-origin"    always;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript application/wasm text/xml application/xml text/javascript;
}
```

Notas:
- `types { application/wasm wasm; }` no nível server complementa (não substitui) o `include /etc/nginx/mime.types` carregado no `http` block do nginx:alpine.
- `add_header` em `location` não herda do `server` → headers repetidos.

## 2. Self-host do `@ffmpeg/core` via prebuild

`package.json`:
```json
"scripts": {
  "dev": "vite",
  "prebuild": "mkdir -p public/ffmpeg && cp node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js public/ffmpeg/ && cp node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm public/ffmpeg/",
  "build": "npm run prebuild && vite build",
  "build:dev": "npm run prebuild && vite build --mode development",
  ...
}
```

`.gitignore` — acrescentar:
```
public/ffmpeg/
```
(gerados no build dentro do Docker, não devem ser versionados).

`@ffmpeg/core` é resolvido transitivamente por `@ffmpeg/ffmpeg@0.12.10`. Dockerfile já roda `npm install` + `npm run build`, prebuild dispara automaticamente.

## 3. `src/lib/audioTranscode.ts` — self-hosted primeiro, unpkg fallback

```ts
const FFMPEG_CORE_VERSION = '0.12.10';
const SELF_HOSTED  = '/ffmpeg';
const CDN_FALLBACK = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;
```

`getFFmpeg()`:
1. `loadFromBase(SELF_HOSTED)` → log `{ cdn: 'self-hosted' }`
2. catch → `loadFromBase(CDN_FALLBACK)` → log `{ cdn: 'unpkg' }`
3. catch → reset `loadPromise`, lança `Falha ao carregar ffmpeg.wasm`

Remove caminho `jsdelivr`. Mantém singleton, `transcodeToOggOpus` intacto.

## Arquivos NÃO tocados

- `ChatPanel.tsx`, `AudioRecorder.tsx`, `whatsappRouter.ts`, `mimeCodec.ts`
- Edge functions, worker, Dockerfile, docker-compose.yml

## Validação manual no VPS

```
git pull
docker compose build app && docker compose up -d --no-deps --force-recreate app
```

Browser (Ctrl+Shift+R):
- Console: `crossOriginIsolated === true`
- Console: `typeof SharedArrayBuffer === 'function'`
- Network `/ffmpeg/ffmpeg-core.wasm` → 200, `Content-Type: application/wasm`, headers COOP/COEP/CORP presentes
- Gravar áudio → log `[audioTranscode] ffmpeg loaded { cdn: 'self-hosted' }` → `[audioTranscode] done`
- Abrir conversa com mídia Supabase → carrega normalmente (credentialless não exige CORP cross-origin)

## Compatibilidade

COEP `credentialless`: Chrome/Edge 96+, Firefox 119+, Safari 17.4+.
