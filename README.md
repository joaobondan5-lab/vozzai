# VozzAI

Ditado por voz com IA para o mercado brasileiro: você fala, o VozzAI transcreve
e devolve o texto já formatado, pronto para colar em qualquer lugar.

## Como funciona

1. Na primeira abertura, o onboarding cria sua conta e explica as duas
   permissões (Microfone e Acessibilidade) antes de o sistema pedir — e só
   termina depois do seu primeiro ditado real
2. Pressione `Cmd+Shift+Space` (configurável) para começar a gravar
3. Fale normalmente — `Esc` cancela sem gastar cota
4. Pressione o atalho de novo para parar
5. O texto revisado é colado onde o cursor estiver, no modo de escrita
   escolhido no menu da barra (WhatsApp, E-mail, Jurídico…)

Se a internet falhar, o ditado não se perde: fica guardado para "Tentar
transcrever de novo" no menu. As últimas 50 transcrições ficam num histórico
local (só texto, nunca áudio), com copiar/reinserir/excluir.

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

Gera um `VozzAI.app` que abre com duplo clique e um instalador `.dmg` em
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
