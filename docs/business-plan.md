# VozzAI — plano de negócio (rascunho inicial)

## O que é

VozzAI é um app de desktop de ditado por voz com IA: você fala, o app transcreve
e já entrega o texto formatado e revisado, pronto para colar em qualquer lugar
(e-mail, documento, chat, código). Conceito equivalente ao do Wispr Flow, mas
pensado desde o início para o mercado brasileiro.

## Problema

Ferramentas de ditado por voz com IA (Wispr Flow, Willow Voice, superwhisper)
são cobradas em dólar, têm suporte fraco a português brasileiro (gírias,
sotaques regionais, termos técnicos em PT-BR) e não oferecem meios de
pagamento locais (Pix, boleto, cartão nacional parcelado).

## Público-alvo (MVP)

1. Profissionais que escrevem muito por dia: advogados, atendimento ao
   cliente, redatores, jornalistas
2. Criadores de conteúdo e social media
3. Estudantes de pós-graduação e concurseiros escrevendo resumos/redações
4. Desenvolvedores escrevendo documentação e mensagens de commit

## Modelo de receita

- Assinatura mensal em BRL, com desconto no plano anual
- Faixa de preço inicial de referência: R$ 29,90/mês (free trial de 7 dias)
- Pagamento via Pix, cartão de crédito nacional (parcelado) e boleto

## Estrutura de custos variável (atenção)

O custo por usuário depende diretamente do uso de APIs de terceiros
(transcrição + limpeza de texto via LLM). É essencial:
- Medir custo médio de API por minuto ditado antes de fixar o preço final
- Definir um limite de uso "justo" no plano padrão para evitar prejuízo em
  usuários muito intensivos

## Riscos

- Dependência de um único provedor externo (OpenAI) — preço e
  disponibilidade da API podem mudar; vale reavaliar multi-provedor se o custo
  ou a confiabilidade virarem problema
- Barreira de permissão do macOS/Windows para captura de microfone (primeira
  execução exige autorização manual do usuário)
- Diferenciação real precisa vir de qualidade em PT-BR, não só de preço

## Próximos passos sugeridos

1. Validar custo real de transcrição/limpeza com áudio de teste em PT-BR
2. Testar o MVP localmente por 1-2 semanas de uso pessoal antes de lançar
3. Decidir nome comercial definitivo e registrar domínio (decisão do
   fundador — envolve gasto financeiro, não deve ser feito de forma
   automática)
