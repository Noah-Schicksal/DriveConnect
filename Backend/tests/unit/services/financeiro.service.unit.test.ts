import { jest, describe, it, expect, afterEach, beforeEach } from '@jest/globals';

jest.unstable_mockModule('../../../src/db/index.js', () => ({
  query: jest.fn(),
}));

jest.unstable_mockModule('../../../src/services/payment.service.js', () => ({
  gerarLinkPagamento: jest.fn(),
}));

const { query } = await import('../../../src/db/index.js');
const { gerarLinkPagamento } = await import('../../../src/services/payment.service.js');
const { estornarPagamento, criarCobrancaExtra } = await import('../../../src/services/financeiro.service.js');

type Caller = {
  usuarioId: string;
  tipo: string;
  filialId: string | null;
};

describe('Financeiro Service', () => {
  const adminCaller: Caller = { usuarioId: '1', tipo: 'ADMIN', filialId: null };
  const gerenteCaller: Caller = { usuarioId: '2', tipo: 'GERENTE', filialId: 'filial-1' };

  let originalFetch: typeof fetch;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn() as any;

    originalEnv = process.env;
    process.env = { ...originalEnv }; // Clona as variáveis de ambiente
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  describe('estornarPagamento', () => {
    it('deve lançar erro se reserva não for encontrada', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });

      await expect(estornarPagamento('reserva-inexistente', adminCaller))
        .rejects.toThrow('Reserva não encontrada.');
    });

    it('deve lançar erro se GERENTE tentar estornar reserva de outra filial', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ 
        rows: [{ id: 'res1', filial_retirada_id: 'outra-filial', filial_devolucao_id: 'outra-filial' }] 
      });

      await expect(estornarPagamento('res1', gerenteCaller))
        .rejects.toThrow('Sem permissão para estornar reserva de outra filial.');
    });

    it('deve lançar erro se reserva não tiver infinitepay_nsu', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ 
        rows: [{ id: 'res1', infinitepay_nsu: null, filial_retirada_id: 'filial-1', filial_devolucao_id: 'filial-1' }] 
      });

      await expect(estornarPagamento('res1', adminCaller))
        .rejects.toThrow('Não há transação da InfinitePay registrada para esta reserva. Ela ainda não foi paga.');
    });

    it('deve simular estorno com sucesso caso não exista INFINITEPAY_API_KEY no env', async () => {
      delete process.env.INFINITEPAY_API_KEY;

      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ // SELECT reserva
          rows: [{ id: 'res1', infinitepay_nsu: 'nsu-123', filial_retirada_id: 'filial-1', filial_devolucao_id: 'filial-1' }] 
        })
        .mockResolvedValueOnce({ rowCount: 1 }); // INSERT transacao

      await estornarPagamento('res1', adminCaller);

      expect(global.fetch).not.toHaveBeenCalled();
      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO transacao'), ['res1']);
    });

    it('deve chamar a API da InfinitePay e atualizar o banco com sucesso se INFINITEPAY_API_KEY existir', async () => {
      process.env.INFINITEPAY_API_KEY = 'minha-api-key';

      (global.fetch as jest.Mock<any>).mockResolvedValueOnce({ ok: true });

      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ // SELECT reserva
          rows: [{ id: 'res1', infinitepay_nsu: 'nsu-123', filial_retirada_id: 'filial-1', filial_devolucao_id: 'filial-1' }] 
        })
        .mockResolvedValueOnce({ rowCount: 1 }); // INSERT transacao

      await estornarPagamento('res1', adminCaller);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith('https://api.infinitepay.io/v1/transactions/nsu-123/refund', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer minha-api-key'
        },
        body: JSON.stringify({ reason: 'CANCELAMENTO_RESERVA' })
      });
      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO transacao'), ['res1']);
    });
  });

  describe('criarCobrancaExtra', () => {
    const itensExtra = [
      { descricao: 'Taxa de lavagem', valor: 50.00 },
      { descricao: 'Combustível faltante', valor: 100.50 }
    ];

    it('deve lançar erro se reserva não for encontrada', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });

      await expect(criarCobrancaExtra('res1', itensExtra, adminCaller))
        .rejects.toThrow('Reserva não encontrada.');
    });

    it('deve lançar erro se GERENTE tentar gerar cobrança extra em reserva de outra filial', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ 
        rows: [{ id: 'res1', filial_retirada_id: 'outra-filial', nome_completo: 'Joao', email: 'joao@email.com' }] 
      });

      await expect(criarCobrancaExtra('res1', itensExtra, gerenteCaller))
        .rejects.toThrow('Sem permissão para gerar cobrança nesta reserva.');
    });

    it('deve gerar link de pagamento e registrar cobrança extra com sucesso', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ // SELECT reserva
          rows: [{ id: 'res1', filial_retirada_id: 'filial-1', nome_completo: 'Joao Silva', email: 'joao@email.com' }] 
        })
        .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE reserva valor_adicional

      (gerarLinkPagamento as jest.Mock<any>).mockResolvedValueOnce({
        link_pagamento: 'https://link.pagamento.io/123',
        slug: 'slug-123'
      });

      const result = await criarCobrancaExtra('res1', itensExtra, adminCaller);

      // Total de extras = 50 + 100.5 = 150.5
      expect(result.valorCobrado).toBe(150.5);
      expect(result.link).toBe('https://link.pagamento.io/123');
      expect(result.nsu_pagamento).toContain('res1_extra_');

      expect(gerarLinkPagamento).toHaveBeenCalledTimes(1);
      expect(gerarLinkPagamento).toHaveBeenCalledWith(
        expect.objectContaining({
          itens: [
            { quantity: 1, price: 5000, description: 'Taxa de lavagem' },
            { quantity: 1, price: 10050, description: 'Combustível faltante' }
          ],
          cliente: { name: 'Joao Silva', email: 'joao@email.com' }
        })
      );

      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenLastCalledWith(
        expect.stringContaining('UPDATE reserva'),
        [150.5, 'res1']
      );
    });
  });
});
