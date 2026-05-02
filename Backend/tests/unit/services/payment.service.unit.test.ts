import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { gerarLinkPagamento, verificarPagamento } from '../../../src/services/payment.service.js';

describe('Payment Service', () => {
  let originalFetch: typeof fetch;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn() as any;

    originalEnv = process.env;
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  describe('gerarLinkPagamento', () => {
    const validParams = {
      orderNsu: 'reserva-123',
      itens: [{ quantity: 1, price: 10000, description: 'Aluguel' }],
    };

    it('deve lançar erro se INFINITEPAY_HANDLE não estiver configurado', async () => {
      delete process.env.INFINITEPAY_HANDLE;

      await expect(gerarLinkPagamento(validParams))
        .rejects.toThrow('INFINITEPAY_HANDLE não configurado no .env');
    });

    it('deve lançar erro se a requisição para a InfinitePay falhar', async () => {
      process.env.INFINITEPAY_HANDLE = 'meu-handle';
      
      (global.fetch as jest.Mock<any>).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: jest.fn().mockResolvedValueOnce('Bad Request')
      });

      await expect(gerarLinkPagamento(validParams))
        .rejects.toThrow('InfinitePay: erro ao gerar link de pagamento. Status 400: Bad Request');
    });

    it('deve chamar a API com o payload correto e retornar o link de pagamento', async () => {
      process.env.INFINITEPAY_HANDLE = 'meu-handle';
      process.env.APP_URL = 'http://backend.com';
      process.env.FRONTEND_URL = 'http://frontend.com';

      const mockResponse = { url: 'https://link.pagamento.io/abc', slug: 'abc' };
      
      (global.fetch as jest.Mock<any>).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce(mockResponse)
      });

      const params = {
        ...validParams,
        cliente: { name: 'João', email: 'joao@email.com' }
      };

      const result = await gerarLinkPagamento(params);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith('https://api.infinitepay.io/invoices/public/checkout/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: 'meu-handle',
          order_nsu: 'reserva-123',
          itens: params.itens,
          redirect_url: 'http://frontend.com/reserva/reserva-123/sucesso',
          webhook_url: 'http://backend.com/pagamento/webhook',
          customer: params.cliente
        })
      });

      expect(result).toEqual({
        link_pagamento: mockResponse.url,
        slug: mockResponse.slug
      });
    });
  });

  describe('verificarPagamento', () => {
    it('deve lançar erro se INFINITEPAY_HANDLE não estiver configurado', async () => {
      delete process.env.INFINITEPAY_HANDLE;

      await expect(verificarPagamento('nsu', 'txn', 'slug'))
        .rejects.toThrow('INFINITEPAY_HANDLE não configurado no .env');
    });

    it('deve lançar erro se a requisição para a InfinitePay falhar', async () => {
      process.env.INFINITEPAY_HANDLE = 'meu-handle';
      
      (global.fetch as jest.Mock<any>).mockResolvedValueOnce({
        ok: false,
        status: 404
      });

      await expect(verificarPagamento('nsu', 'txn', 'slug'))
        .rejects.toThrow('InfinitePay: erro ao verificar pagamento. Status 404');
    });

    it('deve chamar a API com o payload correto e retornar os dados de verificação', async () => {
      process.env.INFINITEPAY_HANDLE = 'meu-handle';

      const mockResponse = {
        success: true,
        paid: true,
        amount: 10000,
        paid_amount: 10000,
        capture_method: 'PIX'
      };

      (global.fetch as jest.Mock<any>).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce(mockResponse)
      });

      const result = await verificarPagamento('order-123', 'txn-123', 'slug-123');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith('https://api.infinitepay.io/invoices/public/checkout/payment_check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: 'meu-handle',
          order_nsu: 'order-123',
          transaction_nsu: 'txn-123',
          slug: 'slug-123'
        })
      });

      expect(result).toEqual({
        pago: true,
        valor: 10000,
        valorPago: 10000,
        metodoPagamento: 'PIX'
      });
    });
  });
});
