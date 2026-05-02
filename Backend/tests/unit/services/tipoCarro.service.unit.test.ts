import { jest, describe, it, expect, afterEach } from '@jest/globals';

jest.unstable_mockModule('../../../src/db/index.js', () => ({
  query: jest.fn(),
}));

jest.unstable_mockModule('../../../src/entities/TipoCarro.js', () => ({
  TipoCarro: {
    validate: jest.fn((data) => data),
    validatePartial: jest.fn((data) => data),
  }
}));

const { query } = await import('../../../src/db/index.js');
const { TipoCarro } = await import('../../../src/entities/TipoCarro.js');
const {
  listarTiposCarro,
  buscarTipoCarroPorId,
  criarTipoCarro,
  atualizarTipoCarro,
  deletarTipoCarro
} = await import('../../../src/services/tipoCarro.service.js');

describe('TipoCarro Service', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  const mockDbRow = {
    id: 1,
    nome: 'SUV',
    preco_base_diaria: '150.00'
  };

  describe('listarTiposCarro', () => {
    it('deve retornar a lista de tipos de carro ordenados por nome', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [mockDbRow] });

      const result = await listarTiposCarro();

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY nome ASC'),
        []
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mockDbRow);
    });
  });

  describe('buscarTipoCarroPorId', () => {
    it('deve retornar null se o tipo de carro não for encontrado', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });

      const result = await buscarTipoCarroPorId(99);

      expect(query).toHaveBeenCalledTimes(1);
      expect(result).toBeNull();
    });

    it('deve retornar o tipo de carro se encontrado', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [mockDbRow] });

      const result = await buscarTipoCarroPorId(1);

      expect(query).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockDbRow);
    });
  });

  describe('criarTipoCarro', () => {
    it('deve validar os dados e criar o tipo de carro', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [mockDbRow] });

      const input = { nome: 'SUV', preco_base_diaria: 150 };
      const result = await criarTipoCarro(input);

      expect(TipoCarro.validate).toHaveBeenCalledWith(input);
      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tipo_carro'),
        ['SUV', 150]
      );
      expect(result).toEqual(mockDbRow);
    });
  });

  describe('atualizarTipoCarro', () => {
    it('deve retornar null se não houver campos a atualizar', async () => {
      const result = await atualizarTipoCarro(1, {});

      expect(TipoCarro.validatePartial).toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('deve atualizar apenas o nome', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [{ ...mockDbRow, nome: 'Sedan' }] });

      const result = await atualizarTipoCarro(1, { nome: 'Sedan' });

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE tipo_carro SET nome = $1'),
        ['Sedan', 1]
      );
      expect(result?.nome).toBe('Sedan');
    });

    it('deve atualizar múltiplos campos e retornar os dados', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [{ id: 1, nome: 'Sedan', preco_base_diaria: '120.00' }] });

      const result = await atualizarTipoCarro(1, { nome: 'Sedan', preco_base_diaria: 120 });

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE tipo_carro SET nome = $1, preco_base_diaria = $2'),
        ['Sedan', 120, 1]
      );
      expect(result?.preco_base_diaria).toBe('120.00');
    });

    it('deve retornar null se o ID não for encontrado no UPDATE', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] }); // Retorno vazio no UPDATE RETURNING

      const result = await atualizarTipoCarro(99, { nome: 'Sedan' });

      expect(result).toBeNull();
    });
  });

  describe('deletarTipoCarro', () => {
    it('deve lançar erro se houver modelos vinculados a este tipo de carro', async () => {
      // Retorna 1 dependente encontrado
      (query as jest.Mock<any>).mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] });

      await expect(deletarTipoCarro(1))
        .rejects.toThrow('Não é possível remover: existem modelos vinculados a este tipo de carro.');
      
      // O DELETE nunca deve ser chamado
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('deve retornar falso se a exclusão não afetar nenhuma linha (ID inexistente)', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rowCount: 0 }) // check de dependentes (ok)
        .mockResolvedValueOnce({ rowCount: 0 }); // falha no delete

      const result = await deletarTipoCarro(99);

      expect(query).toHaveBeenCalledTimes(2);
      expect(result).toBe(false);
    });

    it('deve excluir com sucesso caso não haja dependentes', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rowCount: 0 }) // check de dependentes (ok)
        .mockResolvedValueOnce({ rowCount: 1 }); // sucesso no delete

      const result = await deletarTipoCarro(1);

      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenLastCalledWith(
        expect.stringContaining('DELETE FROM tipo_carro WHERE id = $1'),
        [1]
      );
      expect(result).toBe(true);
    });
  });
});
