import { jest, describe, it, expect, afterEach } from '@jest/globals';

jest.unstable_mockModule('../../../src/db/index.js', () => ({
  query: jest.fn(),
}));

const { query } = await import('../../../src/db/index.js');
const {
  listarPlanos,
  buscarPlanoBasico,
  buscarPlanoPorId,
  calcularValorSeguro,
  criarPlano,
  atualizarPlano,
  desativarPlano
} = await import('../../../src/services/seguro.service.js');

describe('Seguro Service', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  const mockDbRow = {
    id: 'plano-1',
    nome: 'Plano Básico',
    descricao: 'Seguro obrigatório padrão',
    percentual: '10.50',
    obrigatorio: true,
    ativo: true,
  };

  describe('listarPlanos', () => {
    it('deve retornar a lista de planos com o percentual formatado como número', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [mockDbRow] });

      const result = await listarPlanos();

      expect(query).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('plano-1');
      expect(result[0].percentual).toBe(10.50);
      expect(typeof result[0].percentual).toBe('number');
    });
  });

  describe('buscarPlanoBasico', () => {
    it('deve lançar erro se a empresa não tiver um plano básico configurado', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });

      await expect(buscarPlanoBasico()).rejects.toThrow('A empresa não possui um plano de seguro básico configurado.');
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('deve retornar o plano básico com percentual convertido', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [mockDbRow] });

      const result = await buscarPlanoBasico();

      expect(query).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('plano-1');
      expect(result.percentual).toBe(10.50);
    });
  });

  describe('buscarPlanoPorId', () => {
    it('deve retornar null se não encontrar o plano', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });

      const result = await buscarPlanoPorId('plano-1');

      expect(query).toHaveBeenCalledTimes(1);
      expect(result).toBeNull();
    });

    it('deve retornar o plano convertido se encontrado', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [mockDbRow] });

      const result = await buscarPlanoPorId('plano-1');

      expect(query).toHaveBeenCalledTimes(1);
      expect(result?.id).toBe('plano-1');
      expect(result?.percentual).toBe(10.50);
    });
  });

  describe('calcularValorSeguro', () => {
    it('deve calcular corretamente o valor do seguro e arredondar', () => {
      // 10% de 200 = 20
      expect(calcularValorSeguro(10, 200)).toBe(20);
      
      // 10.5% de 150 = 15.75
      expect(calcularValorSeguro(10.5, 150)).toBe(15.75);
      
      // 33.3% de 100 = 33.3
      expect(calcularValorSeguro(33.3, 100)).toBe(33.3);
      
      // Teste de precisão (arredondamento) - ex: 12.345 -> 12.35
      // percentual = 15.2, valor = 81.25 -> 81.25 * 0.152 = 12.35
      expect(calcularValorSeguro(15.2, 81.25)).toBe(12.35);
    });
  });

  describe('criarPlano', () => {
    it('deve criar um plano corretamente', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [mockDbRow] });

      const params = { nome: 'Plano Básico', percentual: 10.5, obrigatorio: true };
      const result = await criarPlano(params);

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO plano_seguro'),
        ['Plano Básico', null, 10.5, true]
      );
      expect(result.id).toBe('plano-1');
    });
  });

  describe('atualizarPlano', () => {
    it('deve retornar null se nenhum campo for enviado para atualização', async () => {
      const result = await atualizarPlano('plano-1', {});

      expect(query).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('deve atualizar os campos fornecidos e retornar o plano atualizado', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [{ ...mockDbRow, nome: 'Novo Nome', percentual: '12.00' }] });

      const result = await atualizarPlano('plano-1', { nome: 'Novo Nome', percentual: 12.00 });

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE plano_seguro'),
        ['Novo Nome', 12.00, 'plano-1']
      );
      expect(result?.nome).toBe('Novo Nome');
      expect(result?.percentual).toBe(12.00);
    });
  });

  describe('desativarPlano', () => {
    it('deve retornar falha se o plano não for encontrado', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });

      const result = await desativarPlano('plano-1');

      expect(query).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ sucesso: false, motivo: 'Plano não encontrado.' });
    });

    it('deve retornar falha se o plano for obrigatório', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [{ obrigatorio: true }] });

      const result = await desativarPlano('plano-1');

      expect(query).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ sucesso: false, motivo: 'O plano obrigatório (Básico) não pode ser desativado.' });
    });

    it('deve desativar o plano com sucesso se ele não for obrigatório', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rows: [{ obrigatorio: false }] }) // Busca do plano
        .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE

      const result = await desativarPlano('plano-1');

      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenLastCalledWith(
        expect.stringContaining('UPDATE plano_seguro SET ativo = FALSE, deletado_em = NOW()'),
        ['plano-1']
      );
      expect(result).toEqual({ sucesso: true });
    });
  });
});
