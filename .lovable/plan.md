## Problema
O `prebuild` quebra em produção porque `node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js` não existe. `@ffmpeg/core` é peer dependency de `@ffmpeg/ffmpeg` e não é instalado automaticamente pelo `npm install`.

## Fix
Adicionar no `package.json`, dentro do bloco `dependencies`:
```json
"@ffmpeg/core": "^0.12.10"
```

A versão `0.12.10` casa com a constante `FFMPEG_CORE_VERSION` já definida em `src/lib/audioTranscode.ts`.

## Arquivos tocados
- `package.json` — adicionar 1 linha em `dependencies`

## Arquivos NÃO tocados
- `src/lib/audioTranscode.ts`, `nginx.conf`, `.gitignore`, Dockerfile, docker-compose.yml, ChatPanel, AudioRecorder, whatsappRouter

## Validação
Após o fix, rodar `npm install` localmente (ou no Docker build) deve criar `node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js` e `.wasm`, fazendo o `prebuild` copiar os arquivos para `public/ffmpeg/` sem erro.

Deploy manual pelo usuário no VPS.