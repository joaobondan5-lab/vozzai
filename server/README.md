# Vozza — servidor

Backend que guarda a chave da OpenAI, controla contas e limita o uso por plano.
É ele que torna o Vozza vendável: o usuário final não precisa de chave nenhuma.

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
| `MP_ACCESS_TOKEN` | Token do Mercado Pago, para confirmar assinaturas. |
| `VOZZA_STT_MODEL` | Modelo de transcrição (padrão `whisper-1`; `gpt-4o-mini-transcribe` custa metade). |
| `PORT` | Porta HTTP (padrão 3000). |

## Rotas

| Rota | O que faz |
|---|---|
| `POST /auth/signup` | Cria conta (`email`, `password`) e devolve token. |
| `POST /auth/login` | Autentica e devolve token. |
| `GET /me` | Dados da conta e uso do período. |
| `POST /transcribe` | Recebe áudio em base64, aplica a cota e devolve o texto pronto. |
| `POST /webhooks/mercadopago` | Recebe avisos de assinatura e atualiza o plano. |

Autenticação: cabeçalho `Authorization: Bearer <token>`.

## Limites por plano

Definidos em `src/quota.ts`. O Pro tem teto alto (120.000 palavras/mês ≈ 13 h de
fala) em vez de "ilimitado" de verdade — cada minuto ditado custa API, e um teto
protege a margem sem atrapalhar o uso normal.

## Confiabilidade

- **Limite de tentativas** em `/auth/login` e `/auth/signup` (10 por 15 min,
  por IP) — protege contra força bruta. Fica em memória, então só funciona bem
  com uma instância rodando; se um dia escalar pra várias instâncias, precisa
  virar algo compartilhado (ex.: Redis).
- **Erros não tratados viram JSON 500** em vez de derrubar a conexão sem
  explicação — ver o middleware de erro no fim de `src/index.ts`.
- Reinício automático em caso de falha fica por conta da plataforma de deploy
  (Railway reinicia sozinho se o processo cair).

## O que ainda falta

- **Mercado Pago não foi testado contra a API real.** O fluxo em
  `src/mercadopago.ts` segue a documentação de *preapproval*, mas precisa rodar
  em sandbox antes de cobrar alguém.
- Não existe rota para *criar* a assinatura (só para receber o aviso de mudança).
- Sem recuperação de senha, sem verificação de e-mail.
