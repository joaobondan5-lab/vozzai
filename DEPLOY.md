# Colocar o VozzAI no ar — passo a passo

Este guia é pra você (só você tem login nas contas). Depois de cada parte
"dashboard", me avisa o que apareceu (principalmente a URL gerada) que eu
atualizo o código pra apontar pra ela.

## 1. Backend no Railway

1. Acesse [railway.app](https://railway.app) e entre (já conectado ao GitHub)
2. **New Project** → **Deploy from GitHub repo** → selecione `vozzai`
3. Assim que o serviço for criado, abra ele → **Settings** → em **Root
   Directory**, digite `server` (é um projeto monorepo, o backend fica numa
   subpasta)
4. Ainda em Settings → **Variables**, adicione:
   - `OPENAI_API_KEY` = sua chave da OpenAI
   - (deixe `MP_ACCESS_TOKEN` de fora por enquanto, adiciona quando tiver o
     token de sandbox do Mercado Pago)
5. Adicione o banco: no projeto, clique em **New** → **Database** →
   **Add PostgreSQL**. O Railway cria sozinho a variável `DATABASE_URL` e
   já disponibiliza ela pro serviço do backend — não precisa copiar nada
6. Volte no serviço do backend → **Settings** → **Networking** → **Generate
   Domain**, pra ele ganhar uma URL pública (tipo
   `vozzai-production.up.railway.app`)
7. **Me manda essa URL** — eu atualizo `extension/`, `src/main/backend.ts` e
   o `manifest.json` pra apontar pra ela em vez de `localhost:4000`

## 2. Landing page no Vercel

1. Acesse [vercel.com](https://vercel.com) e entre (já conectado ao GitHub)
2. **Add New** → **Project** → importe o repositório `vozzai`
3. Na tela de configuração, em **Root Directory**, clique em "Edit" e
   escolha a pasta `web`
4. Framework Preset pode ficar em "Other" (é HTML puro, sem framework)
5. Clique em **Deploy**
6. Você recebe uma URL tipo `vozzai.vercel.app` — já está no ar, pode abrir

## 3. Depois que os dois estiverem no ar

- Me manda a URL do Railway (backend) — esse é o passo que eu realmente
  preciso pra terminar de configurar
- A URL do Vercel (landing) não exige nada de mim, já funciona sozinha

## Não faça ainda

- Não compre o domínio agora — dá pra usar as URLs `.vercel.app` e
  `.up.railway.app` gratuitas por enquanto, até confirmar que o produto
  funciona com gente de fora testando
- Não crie o Apple Developer ainda — só é necessário quando for distribuir
  o app de Mac pra além de você mesmo
