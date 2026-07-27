/**
 * Cópia cliente do catálogo de modos — nomes e disponibilidade por plano.
 * A validação de verdade acontece no servidor (GET /modes é a fonte oficial);
 * esta lista só desenha o menu quando estamos offline ou antes do login.
 */
export interface ClientMode {
  id: string;
  name: string;
  proOnly: boolean;
}

export const CLIENT_MODES: ClientMode[] = [
  { id: 'padrao', name: 'Padrão', proOnly: false },
  { id: 'whatsapp', name: 'WhatsApp', proOnly: false },
  { id: 'email', name: 'E-mail profissional', proOnly: false },
  { id: 'objetivo', name: 'Objetivo', proOnly: false },
  { id: 'fiel', name: 'Transcrição fiel', proOnly: false },
  { id: 'atendimento', name: 'Atendimento', proOnly: true },
  { id: 'vendas', name: 'Vendas', proOnly: true },
  { id: 'juridico', name: 'Jurídico', proOnly: true },
  { id: 'dev', name: 'Desenvolvedor', proOnly: true },
  { id: 'conteudo', name: 'Conteúdo', proOnly: true },
];
