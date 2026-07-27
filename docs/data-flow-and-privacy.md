# VozzAI — fluxo de dados e privacidade

Este documento descreve o que realmente acontece com os dados, na
implementação atual (26/07/2026). Toda promessa pública (landing, política de
privacidade) deve bater com o que está aqui — se o código mudar, este arquivo
e as páginas públicas mudam junto.

## O caminho de um ditado

1. **Captura** — o app grava o microfone só entre o atalho de início e o de
   fim (ou Esc, que descarta tudo). Não existe escuta em segundo plano.
2. **Envio** — o áudio (webm) vai em HTTPS para o backend no Railway, junto
   com o token de sessão, o idioma e o modo de escrita.
3. **Transcrição** — o backend repassa o áudio à OpenAI (Whisper) com a chave
   do servidor. O dicionário pessoal do usuário vai como dica de vocabulário.
4. **Organização** — o texto bruto passa pelo gpt-4o-mini com a instrução do
   modo escolhido. Via API da OpenAI, os dados **não são usados para treinar
   modelos** (política da API); há retenção temporária de abuso/log do lado
   deles (até 30 dias, política da OpenAI).
5. **Retorno** — o texto final volta ao app e é colado no cursor.
6. **Descarte** — o áudio não é gravado em disco em lugar nenhum nosso: nem
   no app, nem no servidor (que o mantém apenas em memória durante a chamada).

## O que fica onde

| Dado | Onde mora | Quem apaga |
|---|---|---|
| Áudio | Lugar nenhum (memória só durante o processamento) | — |
| Texto transcrito | Histórico local do Mac do usuário (últimas 50) | O usuário: item a item, tudo, ou desativando o histórico |
| E-mail + senha (scrypt+salt) | Postgres (Railway) | Pedido via WhatsApp/e-mail (manual hoje) |
| Plano, uso (palavras/segundos por ditado) | Postgres | Idem — é a base da cobrança |
| Tom + dicionário pessoal | Postgres | O próprio usuário pode limpar na UI |
| Token de sessão | `vozza-config.json` no userData do Mac | Sair da conta (logout) |

## O que a telemetria NÃO registra

Não existe telemetria/analytics hoje. Logs do servidor registram códigos de
erro e rotas — nunca o conteúdo do áudio ou do texto ditado. O painel /admin
só devolve agregados (contagens), nunca e-mail ou conteúdo.

## Pendências conhecidas (honestidade > marketing)

- Exclusão de conta é manual (canal WhatsApp/e-mail), sem botão self-service.
- Sem verificação de e-mail e sem recuperação de senha.
- Token de sessão em arquivo JSON plano (não Keychain) — melhoria futura.
- Subprocessadores: OpenAI (transcrição/organização), Railway (hospedagem/BD),
  Vercel (site), Mercado Pago e Asaas (pagamento). A política de privacidade
  pública deve listá-los.
