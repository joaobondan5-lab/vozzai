# Vozza — extensão de Chrome

Ditado por voz dentro do navegador: funciona em Gmail, WhatsApp Web, Google
Docs*, Slack web, Instagram e qualquer campo de texto de uma página. Não
precisa instalar nada além da extensão — ao contrário do app de Mac, funciona
em Windows, Linux e Chromebook também.

## Como testar (modo desenvolvedor)

1. Abra `chrome://extensions`
2. Ative "Modo do desenvolvedor" (canto superior direito)
3. Clique em "Carregar sem compactação" e selecione esta pasta (`extension/`)
4. Já aponta para o backend em produção
   (`https://vozzai-production.up.railway.app`) — não precisa rodar nada local
5. Clique no ícone da extensão para criar conta ou entrar
6. Em qualquer página, aperte `Ctrl+Shift+Espaço` (`⌘+Shift+Espaço` no Mac),
   fale, aperte de novo para parar

## O que foi testado e o que não foi

Sem um Chrome de verdade à disposição, não dá para carregar a extensão e testar
`chrome.commands`, `chrome.offscreen` (captura de microfone) e `chrome.tabs`
ponta a ponta — isso só o usuário consegue verificar, carregando a extensão de
verdade no Chrome.

O que **foi** verificado, fora do contexto de extensão:
- **Inserção de texto** (`content.js`): testada em `<input>`, `<textarea>` e
  `contenteditable` reais. Os dois primeiros funcionam perfeitamente. No
  `contenteditable`, existe uma limitação conhecida (ver abaixo).
- **Login e cadastro** (`popup.js`): testado ponta a ponta contra o servidor
  real — criar conta, guardar token, buscar `/me` e mostrar o uso da cota.
- **CORS do servidor**: sem isso, nenhuma chamada do navegador funcionava;
  corrigido em `server/src/index.ts`.

## Limitações conhecidas

- **Google Docs não funciona.** O editor é renderizado em `<canvas>`, não em
  elementos de texto normais — não existe jeito confiável de inserir texto ali
  via JavaScript de uma extensão. O texto fica copiado; o usuário cola manual.
- **Espaço no fim de um campo `contenteditable` pode sumir.** Se o campo já
  termina em espaço e o ditado é inserido logo depois, o Chrome às vezes
  "engole" esse espaço ao usar `execCommand('insertText')`. Não afeta
  `<input>`/`<textarea>`, só editores como Gmail/WhatsApp Web/Slack.
- **Atalho só funciona com o Chrome em foco** — diferente do app de Mac
  (que é do sistema inteiro), atalhos de extensão são por navegador.
- Sem ícone próprio ainda (usa o ícone padrão de peça de quebra-cabeça).

## Antes de publicar na Chrome Web Store

- Adicionar ícones (16/48/128px) no `manifest.json`
- Cadastro de desenvolvedor na Chrome Web Store (taxa única de US$5)
- Se/quando tiver domínio próprio (ex.: `api.vozza.ai`), trocar `API_BASE` de
  novo e apontar um domínio customizado pro Railway
