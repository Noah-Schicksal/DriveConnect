import { jest, describe, it, expect, afterEach } from '@jest/globals';

jest.unstable_mockModule('../../../src/db/index.js', () => ({
  query: jest.fn(),
}));

jest.unstable_mockModule('../../../src/entities/TabelaPreco.js', () => ({
  TabelaPreco: {
    validate: jest.fn((data) => data),
    validatePartial: jest.fn((data) => data),
  }
}));

const { query } = await import('../../../src/db/index.js');
const { TabelaPreco } = await import('../../../src/entities/TabelaPreco.js');
const {
  listarTabelasPreco,
  buscarTabelaPrecoPorId,
  criarTabelaPreco,
  atualizarTabelaPreco,
  deletarTabelaPreco
} = await import('../../../src/services/tabelaPreco.service.js');

describe('TabelaPreco Service', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  const mockDbRow = {
    id: 1,
    tipo_carro_id: 2,
    tipo_carro_nome: 'SUV',
    filial_id: 'filial-1',
    filial_nome: 'Filial A',
    data_inicio: new Date('2023-01-01'),
    data_fim: new Date('2023-12-31'),
    valor_diaria: '150.00'
  };

  describe('listarTabelasPreco', () => {
    it('deve listar todas as tabelas sem filtros', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [mockDbRow] });

      const result = await listarTabelasPreco();

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(
        expect.not.stringContaining('WHERE'),
        []
      );
      expect(result).toHaveLength(1);
    });

    it('deve aplicar filtros de filial e tipo de carro', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });

      await listarTabelasPreco('filial-1', 2);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE tp.filial_id = $1 AND tp.tipo_carro_id = $2'),
        ['filial-1', 2]
      );
    });
  });

  describe('buscarTabelaPrecoPorId', () => {
    it('deve retornar null se não encontrar', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });

      const result = await buscarTabelaPrecoPorId(99);

      expect(result).toBeNull();
    });

    it('deve retornar os dados se encontrar', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [mockDbRow] });

      const result = await buscarTabelaPrecoPorId(1);

      expect(result).toEqual(mockDbRow);
    });
  });

  describe('criarTabelaPreco', () => {
    const dadosInput = {
      tipo_carro_id: 2,
      filial_id: 'filial-1',
      data_inicio: new Date('2023-01-01'),
      data_fim: new Date('2023-12-31'),
      valor_diaria: 150
    };

    it('deve lançar erro se o tipo de carro não existir', async () => {
      // Promise.all executa as duas em paralelo: [tipoCheck, filialCheck]
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rowCount: 0 }) // tipo_carro = false
        .mockResolvedValueOnce({ rowCount: 1 }); // filial = true

      await expect(criarTabelaPreco(dadosInput))
        .rejects.toThrow('Tipo de carro não encontrado: tipo_carro_id inválido.');
    });

    it('deve lançar erro se a filial não existir', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rowCount: 1 }) // tipo_carro = true
        .mockResolvedValueOnce({ rowCount: 0 }); // filial = false

      await expect(criarTabelaPreco(dadosInput))
        .rejects.toThrow('Filial não encontrada: filial_id inválido.');
    });

    it('deve criar a tabela de preço e retornar os dados completos', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rowCount: 1 }) // tipo_carro = true
        .mockResolvedValueOnce({ rowCount: 1 }) // filial = true
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // INSERT
        .mockResolvedValueOnce({ rows: [mockDbRow] }); // buscar após inserir

      const result = await criarTabelaPreco(dadosInput);

      expect(TabelaPreco.validate).toHaveBeenCalledWith(dadosInput);
      expect(query).toHaveBeenCalledTimes(4); // 2 selects FK + 1 insert + 1 select buscar
      expect(result).toEqual(mockDbRow);
    });
  });

  describe('atualizarTabelaPreco', () => {
    it('deve retornar null se não houver campos a atualizar', async () => {
      const result = await atualizarTabelaPreco(1, {});
      
      expect(TabelaPreco.validatePartial).toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('deve retornar null se a atualização não afetar nenhuma linha', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rowCount: 0 }); // UPDATE não acha o ID

      const result = await atualizarTabelaPreco(1, { valor_diaria: 200 });

      expect(result).toBeNull();
    });

    it('deve atualizar os campos e buscar o resultado em seguida', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE OK
        .mockResolvedValueOnce({ rows: [{ ...mockDbRow, valor_diaria: '200.00' }] }); // Buscar

      const result = await atualizarTabelaPreco(1, { valor_diaria: 200 });

      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenNthCalledWith(1,
        expect.stringContaining('UPDATE tabela_preco SET valor_diaria = $1 WHERE id = $2'),
        [200, 1]
      );
      expect(result?.valor_diaria).toBe('200.00');
    });
  });

  describe('deletarTabelaPreco', () => {
    it('deve retornar falso se a deleção falhar (rowCount = 0)', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rowCount: 0 });

      const result = await deletarTabelaPreco(99);

      expect(result).toBe(false);
    });

    it('deve retornar verdadeiro se deletado com sucesso', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rowCount: 1 });

      const result = await deletarTabelaPreco(1);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM tabela_preco WHERE id = $1'),
        [1]
      );
      expect(result).toBe(true);
    });
  });
});
