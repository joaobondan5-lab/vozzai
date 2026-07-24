# Vozza — servidor

Backend que guarda a chave da OpenAI, controla contas e limita o uso por plano.
É ele que torna o Vozza vendável: o usuário final não precisa de chave nenhuma.

## Rodando local

```bash
npm install
OPENAI_API_KEY=sk-... npm run dev
```

## Variáveis de ambiente

| Variável | Para que serve |
|---|---|
| `OPENAI_API_KEY` | Chave usada para transcrever e limpar o texto. **Obrigatória.** |
| `MP_ACCESS_TOKEN` | Token do Mercado Pago, para confirmar assinaturas. |
| `VOZZA_DB` | Caminho do banco SQLite (padrão: `vozza.db` na pasta atual). |
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

## O que ainda falta

- **Mercado Pago não foi testado contra a API real.** O fluxo em
  `src/mercadopago.ts` segue a documentação de *preapproval*, mas precisa rodar
  em sandbox antes de cobrar alguém.
- Não existe rota para *criar* a assinatura (só para receber o aviso de mudança).
- Sem recuperação de senha, sem verificação de e-mail.
- SQLite funciona bem para começar; com volume, migrar para Postgres (o esquema
  em `src/db.ts` é o mesmo).
- Falta limitar tentativas de login (proteção contra força bruta).
