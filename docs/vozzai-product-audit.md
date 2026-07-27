# VozzAI — auditoria de produto (Fase 0)

Data: 26/07/2026 · baseline antes da rodada de evolução P0/P1.

## Linha de base verificada

| Check | Resultado |
|---|---|
| Build do app Mac (`npm run build` = tsc) | ✅ passa |
| Typecheck do servidor (`npx tsc --noEmit`) | ✅ passa |
| Testes do servidor (`npm test`, Vitest + Postgres local 5433) | ✅ 29 passam, 1 pulado (billing MP, roda só com `MP_ACCESS_TOKEN` de teste) |
| Lint | ⚠️ não existe lint configurado em nenhum pacote |
| Landing (`web/index.html`) | ✅ arquivo estático autocontido, abre direto |
| Build do app (`npm run dist`) | ✅ gera .dmg arm64 **não assinado** (`identity: null`) |

## Stack encontrado

- **App Mac**: Electron 33 + TypeScript. Processo main (~330 linhas) com tray,
  atalho global, colagem via AppleScript; renderer oculto grava áudio
  (MediaRecorder → webm → base64 via IPC). Sem framework de UI.
- **Backend**: Node/Express + Postgres no Railway
  (`vozzai-production.up.railway.app`). OpenAI Whisper (`whisper-1`) transcreve;
  `gpt-4o-mini` limpa/pontua. Cota por palavras medida **no servidor**.
- **Billing**: Mercado Pago Preapproval (cartão) funcionando em produção;
  Asaas (checkout hospedado, Pix automático) implementado e deployado, ainda
  sem credenciais — rota inerte, aguardando sandbox.
- **Extensão Chrome**: MV3, offscreen recording, injeção sob demanda
  (activeTab). v0.1.3 em análise na Web Store.
- **Landing**: HTML único em `web/`, servido com o domínio vozzai.com.br;
  download do .dmg servido do próprio site (98 MB commitado no repo).

## Já existe e funciona

- Conta (signup/login, token opaco em Postgres, scrypt + salt, rate limit 10/15min).
- Cota server-side: Grátis 2.000 palavras/semana (janela móvel de 7 dias),
  Pro 120.000/mês (mês calendário). Não confia no cliente. Sem cobrança dupla
  em retry (uso só é gravado após transcrição bem-sucedida).
- Pipeline ditado: atalho → grava → backend transcreve+limpa → cola no cursor
  (com fallback honesto para clipboard quando falta Acessibilidade, e restauração
  do clipboard anterior).
- Tom (formal/informal) e dicionário pessoal **no servidor** (`PATCH /me`);
  dicionário vira prompt de vocabulário do Whisper.
- Assinatura Pro por cartão (MP) de ponta a ponta, com webhook que consulta a
  API antes de mudar plano.
- Painel `/admin` só-agregados com token.
- Landing honesta (sem depoimento inventado, sem métrica falsa), SEO básico
  (canonical, OG, JSON-LD, sitemap, robots), dark/light, acessibilidade razoável.
- Suporte via WhatsApp real nas páginas públicas e legais.

## Existe parcialmente

- **Estados do app**: só um booleano `isRecording`. Não há estado visível de
  "processando/transcrevendo/inserindo"; entre parar de falar e o texto colar,
  o usuário fica no escuro.
- **Atalho**: configurável no arquivo de config, **sem UI** para trocar; se o
  registro falha (conflito), só loga no console.
- **Tom/dicionário**: o servidor suporta, a landing **vende** ("Dicionário
  pessoal", "Tom de escrita" no plano Pro), mas **nenhum cliente tem UI** para
  editar. Recurso pago sem como usar = risco de honestidade/churn.
- **Erros**: notificações básicas existem, mas sem timeout de rede (fetch pode
  pendurar), sem retry, sem tratamento de áudio vazio (silêncio vira chamada
  paga à OpenAI).

## Não existe

- Histórico local, recuperar/reinserir última transcrição, desfazer.
- Cancelar gravação (Esc) — parar sempre envia e gasta cota.
- Onboarding: primeira execução abre só a tela de login; permissões são
  pedidas pelo sistema sem explicação prévia; nenhuma noção de "primeiro
  ditado concluído".
- Assinatura/notarização (Gatekeeper avisa "desenvolvedor não identificado");
  conta Apple Developer comprada em 26/07, ativação pendente (até 2 dias úteis).
- Atualizador (usuário teria que baixar o .dmg de novo manualmente).
- Modos de escrita, Actions, snippets, aprendizado por correção, memória de
  estilo, analytics/telemetria, painel de valor, indicação, páginas de
  comparação/SEO por profissão, e-mails @vozzai.com.br.
- Limite de duração de gravação (gravação longa pode estourar o limite de
  25 MB do body e falhar depois de o usuário ter falado tudo).

## Existe, mas está quebrado / impreciso

- `usage.seconds` retornado pela OpenAI não existe no `whisper-1` → segundos
  gravados como 0 em `usage` (só `words` é usado para cota; sem impacto, mas o
  dado de duração é mentira silenciosa).
- Notificação de "cota estourada" (402) aparece como erro genérico no app —
  não orienta upgrade.

## Riscos

- **Técnico**: nenhum estado de recuperação — falha de rede depois de falar
  perde o ditado inteiro (áudio é descartado). Maior causa provável de
  desinstalação precoce.
- **Segurança**: token de sessão em JSON plano em `userData` (sem Keychain);
  CORS reflete qualquer origem (aceitável para API pública com Bearer, mas
  documentar); sem verificação de e-mail nem recuperação de senha; app não
  assinado = aviso do Gatekeeper e alvo fácil de tampering.
- **Conversão**: aviso do Gatekeeper no primeiro contato; nenhum onboarding;
  recursos Pro vendidos sem UI; sem demonstração na landing.
- **Billing**: dois provedores em paralelo (MP + Asaas) é dívida técnica
  declarada; downgrade/cancelamento depende de webhook — sem re-verificação
  periódica, um webhook perdido deixa plano errado para sempre.
- **Perda de dados**: config sobrescrita sem backup; sem export/exclusão de
  conta self-service (LGPD atendida hoje só via canal manual).

## Decisões desta rodada (prioridade)

1. **M1 — confiabilidade**: máquina de estados + timeout/retry + Esc cancela +
   limite de gravação + avisos de cota; histórico local com reinserir/copiar;
   atalho configurável com detecção de conflito; onboarding de permissões.
2. **M2 — instalação**: preparar assinatura/notarização completa (scripts,
   entitlements, docs); ativa quando a conta Apple liberar. Sem selo falso.
3. **M3 — diferenciação**: VozzAI Modes tipados com gate por plano no servidor
   + seletor no app/extensão; UI de tom/dicionário (fecha a promessa da landing).
4. **M4 — conversão**: depoimentos reais do beta (pseudônimos declarados),
   seção de modos e privacidade na landing.

Fora desta rodada (documentado, sem promessa pública): Actions, snippets,
memória de estilo, atualizador automático, Teams, Windows, indicação.
Commits locais por milestone, **sem push** (pedido explícito do João).
