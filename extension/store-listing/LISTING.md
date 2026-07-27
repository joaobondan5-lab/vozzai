# Ficha da Chrome Web Store — copia e cola

## Situação atual (27/jul/2026)

A extensão **já está publicada e no ar**, mas com a **marca antiga**:

| | No ar hoje | Deveria ser |
|---|---|---|
| Nome | Vozza — ditado por voz com IA | **VozzAI** — ditado por voz com IA |
| Versão | 0.1.1 | 0.1.4 |
| Recursos | sem modos, sem plano anual | modos de escrita + Pro anual R$249 |

ID da extensão (nunca muda): `hfopblagabjnlkigjnafamfabefdilfe`

## Como atualizar (é seguro, e dá pra repetir sempre)

Publicar **não congela** nada — dá pra atualizar quantas vezes quiser. A
única regra é que o número da versão precisa **subir** (por isso 0.1.4).
Enquanto a nova versão está em análise, **a atual continua no ar**: ninguém
fica sem extensão. Depois de aprovada, o Chrome atualiza os usuários sozinho.

1. Entre em https://chrome.google.com/webstore/devconsole
2. Abra o item **Vozza — ditado por voz com IA**
3. Aba **Pacote** → *Fazer upload de novo pacote* → suba
   `store-listing/vozzai-extension.zip` (versão 0.1.4)
4. Aba **Página "Detalhes do app"** → corrija o **Título** e a **Descrição**
   com os textos abaixo (ambos ainda dizem "Vozza")
5. Clique em **Enviar para análise**

## Título do pacote

```
VozzAI — ditado por voz com IA
```

## Descrição curta (até 132 caracteres)

```
Fale e o texto aparece — ditado por voz com IA em português do Brasil, em qualquer campo de texto do navegador.
```

## Descrição detalhada

```
VozzAI é ditado por voz com IA feito para o português do Brasil.

Aperte o atalho, fale normalmente — com gírias, hesitações, do jeito
que você fala mesmo — e o texto aparece pontuado e formatado, direto
no campo onde seu cursor está. Funciona no Gmail, WhatsApp Web, Notion,
Google Docs (campos de texto padrão), VS Code Web, campos de busca e
praticamente qualquer lugar em que você digitaria.

COMO FUNCIONA
1. Aperte Ctrl+Shift+Espaço (Cmd+Shift+Espaço no Mac)
2. Fale
3. O texto revisado aparece onde você estava digitando

MODOS DE ESCRITA
O mesmo ditado, no tom certo de cada lugar. Escolha o modo no popup:
- Padrão: texto limpo e pontuado, fiel ao seu jeito de falar
- WhatsApp: mensagem natural e curta
- E-mail profissional: saudação, parágrafos e fechamento
- Objetivo: sem redundância, só os fatos
- Transcrição fiel: só pontuação, nenhuma palavra alterada
E no plano Pro: Atendimento, Vendas, Jurídico, Desenvolvedor e Conteúdo.

RECURSOS
- Pontuação, maiúsculas e formatação automáticas
- Entende gírias e sotaques do português brasileiro
- Dicionário pessoal para nomes e termos técnicos (Pro)
- Tom formal ou informal, sua escolha (Pro)
- Áudio usado só para transcrever e depois descartado — não treina
  modelo nenhum e não é vendido

Plano grátis com 2.000 palavras por semana, sem cartão.
Pro por R$ 29,90/mês ou R$ 249/ano (economize 30%).
```

## Categoria

Produtividade

## Justificativa de permissões (a Google pede isso no formulário)

- **storage**: guardar o token de login da sua conta VozzAI e o modo de
  escrita escolhido, no navegador
- **offscreen**: gravar o áudio do microfone em segundo plano (service
  workers do Manifest V3 não acessam o microfone diretamente)
- **tabs**: identificar a aba ativa para enviar a ela o texto transcrito
- **activeTab**: acessar a aba ativa apenas no momento em que o usuário
  aciona o atalho de ditado, sem precisar de acesso permanente a todos
  os sites
- **scripting**: injetar o script que insere o texto transcrito na aba,
  só quando o ditado é acionado (em vez de rodar em toda página aberta)
- **host_permissions (vozzai-production.up.railway.app)**: enviar o
  áudio gravado para o nosso servidor transcrever

Se o Google já tiver salvo justificativas antigas de "código remoto" ou de
`content_scripts`/`<all_urls>`, ignore — desde a 0.1.1 isso foi trocado por
injeção sob demanda com `activeTab`.

## Propósito único (single purpose)

```
Transformar a fala do usuário em texto formatado, inserido diretamente
no campo de texto ativo da página que ele está usando.
```

## Política de privacidade (URL)

```
https://www.vozzai.com.br/privacy.html
```

## Ícone e capturas de tela

- Ícone: já embutido no pacote (`extension/icons/icon128.png`)
- Captura de tela (1280×800): `store-listing/screenshot-1280x800.png`
- Blocos promocionais: `promo-small-440x280.png` e `promo-marquee-1400x560.png`
