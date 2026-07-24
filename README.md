# Vozza

Ditado por voz com IA para o mercado brasileiro: você fala, o Vozza transcreve
e devolve o texto já formatado, pronto para colar em qualquer lugar.

## Como funciona (MVP)

1. Pressione `Cmd+Shift+Space` para começar a gravar
2. Fale normalmente
3. Pressione `Cmd+Shift+Space` de novo para parar
4. O texto transcrito e revisado é copiado automaticamente para a área de
   transferência

## Rodando localmente

```bash
npm install
cp .env.example .env
# edite o .env e preencha OPENAI_API_KEY
npm start
```

Na primeira execução, o macOS vai pedir permissão de microfone — autorize
para o app funcionar.

## Estrutura

- `src/main` — processo principal do Electron (atalho global, transcrição,
  limpeza de texto, clipboard)
- `src/renderer` — janela oculta responsável por gravar o áudio do microfone
- `web/index.html` — landing page (arquivo único, autocontido). Abra direto no
  navegador para ver.
- `docs/business-plan.md` e `docs/marketing-plan.md` — rascunhos iniciais de
  negócio e marketing

## Como contribuir

1. Crie uma branch a partir da `main`
2. Faça suas alterações e um commit descritivo
3. Abra um Pull Request explicando o que foi mudado e por quê
