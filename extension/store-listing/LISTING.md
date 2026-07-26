# Ficha da Chrome Web Store — copia e cola

## O que você precisa fazer (só você tem acesso)

1. Entre em https://chrome.google.com/webstore/devconsole com sua conta Google
2. Pague a taxa única de registro de desenvolvedor (US$ 5)
3. **New Item** → suba o arquivo `vozza-extension.zip` (gerado do código de `extension/`)
4. Preencha os campos abaixo com o texto pronto
5. Envie para revisão

Depois de enviado, me avisa — a revisão do Google normalmente leva de
algumas horas a poucos dias, não depende de mim.

## Descrição curta (título abaixo do nome, até 132 caracteres)

```
Fale e o texto aparece — ditado por voz com IA em português do Brasil, em qualquer campo de texto do navegador.
```

## Descrição detalhada

```
Vozza é ditado por voz com IA feito para o português do Brasil.

Aperte o atalho, fale normalmente — com gírias, hesitações, do jeito
que você fala mesmo — e o texto aparece pontuado e formatado, direto
no campo onde seu cursor está. Funciona no Gmail, WhatsApp Web, Notion,
Google Docs (campos de texto padrão), VS Code Web, campos de busca e
praticamente qualquer lugar em que você digitaria.

COMO FUNCIONA
1. Aperte Ctrl+Shift+Espaço (Cmd+Shift+Espaço no Mac)
2. Fale
3. O texto revisado aparece onde você estava digitando

RECURSOS
- Pontuação, maiúsculas e formatação automáticas
- Entende gírias e sotaques do português brasileiro
- Dicionário pessoal para nomes e termos técnicos (Premium)
- Tom formal ou informal, sua escolha (Premium)
- Áudio usado só para transcrever e depois descartado — não treina
  modelo nenhum e não é vendido

Plano grátis com 2.000 palavras por semana. Sem cartão para começar.
```

## Categoria

Produtividade

## Justificativa de permissões (a Google pede isso no formulário)

- **storage**: guardar o token de login da sua conta Vozza no navegador
- **offscreen**: gravar o áudio do microfone em segundo plano (service
  workers do Manifest V3 não acessam o microfone diretamente)
- **tabs**: identificar a aba ativa para inserir o texto transcrito nela
- **host_permissions (vozzai-production.up.railway.app)**: enviar o
  áudio gravado para o nosso servidor transcrever

## Propósito único (single purpose)

```
Transformar a fala do usuário em texto formatado, inserido diretamente
no campo de texto ativo da página que ele está usando.
```

## Política de privacidade (URL)

```
https://vozzai.vercel.app/privacy.html
```

## Ícone e capturas de tela

- Ícone: já embutido no pacote (`extension/icons/icon128.png`)
- Captura de tela (1280×800): `store-listing/screenshot-1280x800.png`
  (nesta mesma pasta — sobe ela na seção de imagens da ficha)
