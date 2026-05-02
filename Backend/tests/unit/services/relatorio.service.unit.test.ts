import { jest, describe, it, expect, afterEach } from '@jest/globals';

jest.unstable_mockModule('../../../src/db/index.js', () => ({
  query: jest.fn(),
}));

const { query } = await import('../../../src/db/index.js');
const {
  obterFaturamento,
  obterOcupacao,
  obterOperacao
} = await import('../../../src/services/relatorio.service.js');

type Caller = {
  usuarioId: string;
  tipo: string;
  filialId: string | null;
};

describe('Relatorio Service', () => {
  const adminCaller: Caller = { usuarioId: '1', tipo: 'ADMIN', filialId: null };
  const gerenteCaller: Caller = { usuarioId: '2', tipo: 'GERENTE', filialId: 'filial-1' };

  const mockMinData = { rows: [{ min_data: '2023-01-01T12:00:00.000Z' }] };

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validarDataInicio (interno)', () => {
    it('deve lançar erro se dataInicio for anterior à inauguração da filial', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce(mockMinData);

      await expect(obterFaturamento(adminCaller, '2022-12-31', '2023-12-31'))
        .rejects.toThrow('A data inicial informada não pode ser anterior à data de inauguração da filial (2023-01-01).');
    });

    it('não deve lançar erro se dataInicio for igual ou posterior à inauguração da filial', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce(mockMinData) // validarDataInicio
        .mockResolvedValueOnce({ rows: [{ total_base: '0', total_extra: '0', faturamento_total: '0', qtd_reservas: '0' }] }); // obterFaturamento

      await expect(obterFaturamento(adminCaller, '2023-01-02', '2023-12-31'))
        .resolves.toBeDefined();
    });
  });

  describe('obterFaturamento', () => {
    it('deve retornar faturamento corretamente para ADMIN sem filtro de filial', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce(mockMinData) // validarDataInicio
        .mockResolvedValueOnce({
          rows: [{ total_base: '1000', total_extra: '200', faturamento_total: '1200', qtd_reservas: '5' }]
        });

      const result = await obterFaturamento(adminCaller, '2023-01-02', '2023-01-31');

      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenLastCalledWith(expect.not.stringContaining('AND r.filial_retirada_id ='), ['2023-01-02', '2023-01-31']);
      expect(result).toEqual({ faturamentoTotal: 1200, totalBase: 1000, totalExtra: 200, qtdReservas: 5 });
    });

    it('deve forçar a filial do GERENTE e ignorar o parâmetro solicitado', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce(mockMinData) // validarDataInicio
        .mockResolvedValueOnce({
          rows: [{ total_base: '0', total_extra: '0', faturamento_total: '0', qtd_reservas: '0' }]
        });

      // Gerente tenta ver de outra filial ('filial-999'), mas o buildFilialFilter deve forçar 'filial-1'
      await obterFaturamento(gerenteCaller, '2023-01-02', '2023-01-31', 'filial-999');

      expect(query).toHaveBeenLastCalledWith(
        expect.stringContaining('AND r.filial_retirada_id = $3'),
        ['2023-01-02', '2023-01-31', 'filial-1']
      );
    });
  });

  describe('obterOcupacao', () => {
    it('deve calcular a taxa de ocupacao corretamente', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce(mockMinData) // validarDataInicio
        .mockResolvedValueOnce({ rows: [{ total: '10', manutencao: '2' }] }) // veículos totais
        .mockResolvedValueOnce({ rows: [{ alugados: '3' }] }); // veículos alugados

      const result = await obterOcupacao(adminCaller, '2023-01-02', '2023-01-31', 'filial-1');

      expect(query).toHaveBeenCalledTimes(3);
      expect(result).toEqual({
        total: 10,
        DISPONIVEL: 5, // 10 (total) - 2 (manutencao) - 3 (alugado)
        ALUGADO: 3,
        MANUTENCAO: 2,
        taxaOcupacao: 30 // (3 alugados / 10 total) * 100
      });
    });

    it('deve lidar com total de frota igual a 0 sem gerar erro de divisão por zero (NaN)', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce(mockMinData)
        .mockResolvedValueOnce({ rows: [{ total: '0', manutencao: '0' }] })
        .mockResolvedValueOnce({ rows: [{ alugados: '0' }] });

      const result = await obterOcupacao(adminCaller, '2023-01-02', '2023-01-31');

      expect(result.taxaOcupacao).toBe(0);
      expect(result.DISPONIVEL).toBe(0);
    });
  });

  describe('obterOperacao', () => {
    it('deve retornar contadores de retiradas, devolucoes e atrasos', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce(mockMinData) // validarDataInicio
        .mockResolvedValueOnce({ rows: [{ qtd: '5' }] }) // retiradas
        .mockResolvedValueOnce({ rows: [{ qtd: '3' }] }) // devolucoes
        .mockResolvedValueOnce({ rows: [{ qtd: '1' }] }); // atrasados

      const result = await obterOperacao(adminCaller, '2023-01-02', '2023-01-31');

      expect(query).toHaveBeenCalledTimes(4);
      expect(result).toEqual({ retiradas: 5, devolucoes: 3, emAtraso: 1 });
    });
  });
});
