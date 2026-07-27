# VozzAI — servidor

Backend que guarda a chave da OpenAI, controla contas e limita o uso por plano.
É ele que torna o VozzAI vendável: o usuário final não precisa de chave nenhuma.

Banco de dados: **Postgres**. Não usa mais SQLite — um arquivo local não
sobrevive a reinícios/deploys na nuvem, então isso deixou de ser opção assim
que o objetivo virou "rodar de verdade" em vez de só prototipar.

## Rodando local

Precisa de um Postgres rodando (local ou remoto) e sua `DATABASE_URL`:

```bash
npm install
OPENAI_API_KEY=sk-... DATABASE_URL=postgresql://usuario@localhost:5432/vozza npm run dev
```

O schema (tabelas) é criado automaticamente ao iniciar — não precisa rodar
migração manual.

### Sem Postgres instalado?

No Mac, o [Postgres.app](https://postgresapp.com) roda sem precisar de
Homebrew nem privilégio de admin: baixa, arrasta pra Applications, abre, cria
um servidor local. Depois só apontar a `DATABASE_URL` pra ele.

## Variáveis de ambiente

| Variável | Para que serve |
|---|---|
| `OPENAI_API_KEY` | Chave usada para transcrever e limpar o texto. **Obrigatória.** |
| `DATABASE_URL` | Conexão com o Postgres. **Obrigatória.** |
| `MP_ACCESS_TOKEN` | Token do Mercado Pago (`TEST-...` em dev, `APP_USR-...` em produção). |
| `ADMIN_TOKEN` | Libera o painel `/admin`. Sem ela, o painel responde 503 (fechado de propósito). |
| `MP_WEBHOOK_SECRET` | Assinatura secreta dos webhooks do Mercado Pago (painel → Webhooks). Opcional; com ela, notificação sem `x-signature` válida leva 401. |
| `VOZZA_STT_MODEL` | Modelo de transcrição (padrão `whisper-1`; `gpt-4o-mini-transcribe` custa metade). |
| `PORT` | Porta HTTP (padrão 3000). |

Modelo completo em `.env.example`.

## Rotas

| Rota | O que faz |
|---|---|
| `POST /auth/signup` | Cria conta (`email`, `password`) e devolve token. |
| `POST /auth/login` | Autentica e devolve token. |
| `GET /me` | Dados da conta, preferências e uso do período. |
| `PATCH /me` | Atualiza `tone` (formal/informal) e `dictionary` (até 2.000 chars). |
| `GET /modes` | Catálogo dos modos de escrita (sem as instruções internas). |
| `POST /transcribe` | Recebe áudio em base64 e `mode` opcional, aplica a cota e devolve o texto pronto. Modo Pro sem plano Pro = 403, antes de qualquer chamada paga. |
| `POST /waitlist` | Guarda e-mail de quem ainda não tem Mac. |
| `POST /billing/subscribe` | Cria a assinatura no Mercado Pago (cartão) e devolve o link de checkout. |
| `POST /billing/subscribe/pix` | Cria o checkout na Asaas (Pix automático + cartão) e devolve o link. |
| `POST /webhooks/mercadopago` | Recebe avisos de assinatura do Mercado Pago e atualiza o plano. |
| `POST /webhooks/asaas` | Recebe avisos de pagamento da Asaas (header `asaas-access-token`) e atualiza o plano. |
| `GET /admin` | Painel de métricas (pede o `ADMIN_TOKEN` na primeira visita). |
| `GET /admin/metrics` | JSON com agregados do negócio — exige header `x-admin-token`. |

Autenticação: cabeçalho `Authorization: Bearer <token>`.

## Limites por plano

Definidos em `src/quota.ts`. O Pro tem teto alto (120.000 palavras/mês ≈ 13 h de
fala) em vez de "ilimitado" de verdade — cada minuto ditado custa API, e um teto
protege a margem sem atrapalhar o uso normal.

## Confiabilidade e segurança

- **Limite de tentativas** em `/auth/login` e `/auth/signup` (10 por 15 min,
  por IP) — protege contra força bruta. Fica em memória, então só funciona bem
  com uma instância rodando; se um dia escalar pra várias instâncias, precisa
  virar algo compartilhado (ex.: Redis).
- **Limite de chamadas no `/transcribe`** (60 por 15 min, por usuário) — a
  cota conta palavras, mas o custo do Whisper é por minuto de áudio; sem esse
  teto, uma conta grátis conseguiria queimar API com áudio de silêncio.
- **Body de 1 MB** em todas as rotas, exceto `/transcribe` (25 MB, que recebe
  áudio). Corpo grande fora dali leva 413.
- **Reconciliação periódica do Mercado Pago**: rede de segurança para quando o
  webhook nunca chega (Railway fora do ar no instante da notificação, falha
  transitória na API do MP). A cada hora (e uma vez logo na subida do
  processo), o servidor revarre todo mundo com assinatura MP conhecida e
  resincroniza o plano com o estado real — uma falha numa assinatura não
  impede as outras. Roda só em produção (`src/index.ts`), não durante os
  testes (`src/app.ts`).
- **Webhooks autenticados**: Asaas exige o token estático (comparação em tempo
  constante); Mercado Pago valida a assinatura `x-signature` (HMAC-SHA256)
  quando `MP_WEBHOOK_SECRET` está configurado — e, com ou sem secret, nunca
  confia no corpo: consulta a API antes de mudar plano.
- **CORS com lista de origens** (vozzai.com.br, previews Vercel, localhost,
  extensão de Chrome) em vez de refletir qualquer origem; headers `nosniff`,
  `X-Frame-Options: DENY` e `Referrer-Policy: no-referrer` em toda resposta.
- **Sem shell**: nenhuma rota executa comando de sistema; senhas com scrypt +
  salt e comparações de segredo sempre em tempo constante.
- **Erros não tratados viram JSON 500** em vez de derrubar a conexão sem
  explicação — ver o middleware de erro no fim de `src/app.ts`.
- Reinício automático em caso de falha fica por conta da plataforma de deploy
  (Railway reinicia sozinho se o processo cair).

## Testes

```bash
npm test
```

Precisa do Postgres local rodando na porta 5433 (Postgres.app). Os testes usam
**sempre** um banco próprio (`vozza_test`, criado sozinho na primeira execução)
— o `DATABASE_URL` do ambiente é ignorado de propósito, para ser impossível
tocar em produção por engano.

O teste de assinatura chama o **sandbox** do Mercado Pago e só roda se houver
um token de teste no ambiente (sem ele, é pulado — a suíte continua verde):

```bash
MP_ACCESS_TOKEN=TEST-... npm test
```

Um token `APP_USR-...` no ambiente é descartado pelos testes automaticamente.

A estrutura: `src/app.ts` exporta o app Express sem abrir porta (é o que os
testes montam em memória); `src/index.ts` é só o entrypoint de produção.

## Painel /admin

Métricas agregadas do negócio (MRR estimado, assinantes, cadastros, uso,
lista de espera) em `GET /admin` — pede o `ADMIN_TOKEN` na primeira visita e
guarda no navegador. A resposta nunca inclui e-mail, texto ditado ou qualquer
dado individual, só contagens. Sem `ADMIN_TOKEN` no ambiente o painel inteiro
responde 503.

## Dois provedores de pagamento (por enquanto)

O Mercado Pago (`/billing/subscribe`) só oferece cartão pra esta conta — Pix
automático ainda não foi liberado por eles. A Asaas (`/billing/subscribe/pix`)
já suporta Pix automático via checkout hospedado, então está em avaliação ao
lado do Mercado Pago, não no lugar dele. Depois de validar em produção, um dos
dois deve virar o único (ter dois é dívida técnica, não destino final).

## O que ainda falta

- Sem recuperação de senha, sem verificação de e-mail.
- Rate limit em memória (uma instância só); Redis se um dia escalar.
- Integração com a Asaas só foi testada em sandbox, nunca contra a API real.
