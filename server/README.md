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

## Modos e tom

São dois eixos independentes, e a distinção é o que faz os dois conviverem:

- **Modo** (`mode` no `/transcribe`) manda no **formato** — e-mail vira corpo de
  e-mail, Objetivo encurta, Fiel não mexe em nada. Catálogo em `src/modes.ts`;
  criar um modo novo é só acrescentar ali, sem tocar no app nem na extensão,
  que puxam a lista de `GET /modes`.
- **Tom** (`tone` no `PATCH /me`) manda no **registro** — Formal troca gíria por
  palavra neutra, Informal preserva o jeito de falar. Nada mais: se o texto de
  tom começar a falar de tamanho, parágrafo ou saudação, ele briga com o modo.
  Foi assim que o tom ficou preso ao Padrão por um tempo. Há teste guardando.

Duas exceções, declaradas em `Mode.toneRule`, onde o registro é definição e não
preferência: **Transcrição fiel** (`'none'` — prometemos não trocar palavra
nenhuma) e **Jurídico** (`'always-formal'`). A tela de configurações do app diz
isso ao usuário por escrito, e um teste falha se o conjunto mudar sem o texto
acompanhar.

`UNIVERSAL_RULES` é anexado ao prompt de **todo** modo, inclusive dos futuros:
proíbe placeholder (`[Seu Nome]`), saudação/despedida/assinatura que a pessoa
não ditou, fato inventado, e — a que só apareceu no teste com voz real —
completar trecho que a transcrição entregou quebrado. Essa última importa mais
do que parece: quem ditou reconhece `se falta` como erro e corrige, mas um
remendo plausível (`Se faltar, me avisa`) passa batido e vai pro cliente.

## Eventos de produto

`events` guarda os passos que as pessoas dão (cadastro, ditado, erro, cota,
checkout, permissões, onboarding). É o que permite o painel responder **onde
a pessoa parou** — sem eles só dá para ver o resultado, nunca o caminho.

- **Servidor** emite sozinho: `signup`, `dictation_ok`, `dictation_error`,
  `quota_blocked`, `mode_denied`, `checkout_started`, `plan_activated`,
  `plan_ended`. Chegam mesmo com app/extensão desatualizados.
- **Clientes** emitem o que só eles sabem via `POST /events`: permissões,
  passos do onboarding, cancelamento, falha ao colar, troca de modo.
- **Privacidade**: `src/events.ts` tem allowlist de nomes E de chaves de
  props. Qualquer coisa fora dela é descartada antes de gravar — áudio,
  texto ditado e e-mail nunca entram. Números viram faixas (`words_bucket`).
- `track()` é fire-and-forget de propósito; `flushEvents()` existe só para os
  testes esperarem as gravações antes de truncar as tabelas.

## Painel /admin

`GET /admin` (pede o `ADMIN_TOKEN` na primeira visita e guarda no navegador;
sem a variável no ambiente, tudo responde 503). Sete abas:

| Aba | Responde |
|---|---|
| **Visão geral** | MRR, ativação, conversão, North Star (ditados/ativo/semana), série de 30 dias e uma **leitura automática** do que os números significam |
| **Funil** | Cadastro → 1º ditado → 3 → 10 → checkout → Pro, com a queda de cada passo e o **maior gargalo** apontado |
| **Retenção** | Coortes semanais em heatmap: de cada turma, quantos voltaram nas semanas seguintes |
| **Dinheiro** | MRR/ARR, custo de API estimado, margem bruta, custo por ativo e por ditado, lista de assinantes |
| **Usuários** | Quatro segmentos acionáveis: nunca ditaram, perto da cota, sumiram, quem mais usa — cada um com copiar e-mails |
| **Produto** | Taxa de falha, erros por código, uso por modo, todos os eventos registrados |
| **Leads** | Contas e lista de espera, com copiar e-mails e **exportar CSV** |

Rotas: `/admin/dashboard` (tudo agregado, sem PII — tem teste garantindo),
`/admin/leads` e os segmentos são as únicas que expõem e-mail, de propósito:
é a lista de contato. A fronteira é deliberada — quem quer número não precisa
ver PII.

O custo de API é **estimativa**: o whisper-1 não devolve a duração do áudio,
então o tempo de fala é inferido das palavras (≈150 ppm) e somado ao custo de
tokens do gpt-4o-mini. Serve para ordem de grandeza e margem, não para
contabilidade. Cotação do dólar via `USD_BRL_RATE` (padrão 5,4).

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
