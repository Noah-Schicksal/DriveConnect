import 'dotenv/config';

const INFINITEPAY_API = 'https://api.infinitepay.io/invoices/public/checkout';

interface ItemPagamento {
  quantity: number;
  price: number; // valor em centavos
  description: string;
}

interface ClientePagamento {
  name: string;
  email: string;
  phone_number?: string;
}

interface GerarLinkParams {
  orderNsu: string; // ID da reserva no nosso sistema
  itens: ItemPagamento[];
  cliente?: ClientePagamento;
  redirectUrl?: string;
  webhookUrl?: string;
}

interface RespostaLink {
  link_pagamento: string;
  slug: string;
}

/**
 * Gera um link de checkout na InfinitePay para uma reserva.
 * O order_nsu é o ID da reserva, garantindo rastreabilidade bidirecional.
 */
export async function gerarLinkPagamento(params: GerarLinkParams): Promise<RespostaLink> {
  const handle = process.env.INFINITEPAY_HANDLE;
  const appUrl = process.env.APP_URL ?? '';
  const frontendUrl = process.env.FRONTEND_URL ?? '';

  if (!handle) throw new Error('INFINITEPAY_HANDLE não configurado no .env');

  const payload: Record<string, unknown> = {
    handle,
    order_nsu: params.orderNsu,
    itens: params.itens,
    redirect_url: params.redirectUrl ?? `${frontendUrl}/reserva/${params.orderNsu}/sucesso`,
    webhook_url: params.webhookUrl ?? `${appUrl}/pagamento/webhook`,
  };

  if (params.cliente) {
    payload.customer = params.cliente;
  }

  const resposta = await fetch(`${INFINITEPAY_API}/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resposta.ok) {
    const erro = await resposta.text();
    throw new Error(`InfinitePay: erro ao gerar link de pagamento. Status ${resposta.status}: ${erro}`);
  }

  const dados = await resposta.json() as { url: string; slug: string };

  return {
    link_pagamento: dados.url,
    slug: dados.slug,
  };
}

interface VerificacaoPagamento {
  pago: boolean;
  valor: number;
  valorPago: number;
  metodoPagamento: string;
}

/**
 * Verifica o status de um pagamento na InfinitePay.
 * Use como fallback caso o webhook não chegue.
 */
export async function verificarPagamento(
  orderNsu: string,
  transactionNsu: string,
  slug: string,
): Promise<VerificacaoPagamento> {
  const handle = process.env.INFINITEPAY_HANDLE;
  if (!handle) throw new Error('INFINITEPAY_HANDLE não configurado no .env');

  const resposta = await fetch(`${INFINITEPAY_API}/payment_check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle, order_nsu: orderNsu, transaction_nsu: transactionNsu, slug }),
  });

  if (!resposta.ok) {
    throw new Error(`InfinitePay: erro ao verificar pagamento. Status ${resposta.status}`);
  }

  const dados = await resposta.json() as {
    success: boolean;
    paid: boolean;
    amount: number;
    paid_amount: number;
    capture_method: string;
  };

  return {
    pago: dados.paid,
    valor: dados.amount,
    valorPago: dados.paid_amount,
    metodoPagamento: dados.capture_method,
  };
}
