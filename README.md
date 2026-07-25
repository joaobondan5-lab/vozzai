# Vozza

Ditado por voz com IA para o mercado brasileiro: você fala, o Vozza transcreve
e devolve o texto já formatado, pronto para colar em qualquer lugar.

## Como funciona (MVP)

1. Crie uma conta ou entre (janela de Configurações, abre sozinha na primeira
   vez) — sem chave de API nenhuma, é só e-mail e senha
2. Pressione `Cmd+Shift+Space` para começar a gravar
3. Fale normalmente
4. Pressione `Cmd+Shift+Space` de novo para parar
5. O texto transcrito e revisado é colado automaticamente onde o cursor
   estiver

A transcrição roda no [servidor](server/) — o app não fala mais direto com a
OpenAI, então não existe chave para cada usuário configurar.

## Rodando localmente

```bash
npm install
npm start
```

Precisa do [servidor](server/) rodando em paralelo (por padrão em
`http://localhost:4000` — ver `src/main/backend.ts` para trocar).

Na primeira execução, o macOS vai pedir permissão de microfone e, depois,
de Acessibilidade (para colar o texto sozinho) — autorize as duas.

## Gerando o app (.app / .dmg)

```bash
npm run dist
```

Gera um `Vozza.app` que abre com duplo clique e um instalador `.dmg` em
`release/` (não versionado). O build é para Mac Apple Silicon (arm64) e não é
assinado — no primeiro uso, clique com o botão direito no app e escolha "Abrir"
para passar pelo Gatekeeper.

## Estrutura

- `src/main` — processo principal do Electron (atalho global, login, clipboard,
  colar no cursor)
- `src/renderer` — janela oculta responsável por gravar o áudio do microfone
- `server/` — backend (contas, cota de uso, chama a OpenAI com a chave
  centralizada)
- `extension/` — extensão de Chrome (ditado dentro do navegador)
- `web/index.html` — landing page (arquivo único, autocontido). Abra direto no
  navegador para ver.
- `docs/business-plan.md` e `docs/marketing-plan.md` — rascunhos iniciais de
  negócio e marketing

## Como contribuir

1. Crie uma branch a partir da `main`
2. Faça suas alterações e um commit descritivo
3. Abra um Pull Request explicando o que foi mudado e por quê
