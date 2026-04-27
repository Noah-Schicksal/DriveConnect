// ──────────────────────────────────────────────
// Serviço para integrar com WhatsApp Cloud API
// ──────────────────────────────────────────────

/**
 * Função para enviar uma mensagem via WhatsApp
 * @param to Número de telefone do destinatário
 * @param text Texto da mensagem a ser enviada
 */
export async function sendMessage(to: string, text: string): Promise<void> {
    // A lógica de integração com axios e Graph API vai ser implementada aqui
    console.log(`[WhatsApp Service] Mensagem simulada para ${to}: ${text}`);
}

/**
 * Função para processar a chegada de um webhook (mensagens recebidas, atualizações de status)
 * @param payload Dados em JSON recebidos pelo Webhook
 */
export async function processIncomingMessage(payload: any): Promise<void> {
    // Parsing do payload e decisão de resposta
    console.log(`[WhatsApp Service] Webhook recebido.`);
}
