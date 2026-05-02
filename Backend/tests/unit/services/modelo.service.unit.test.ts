import { jest, describe, it, expect, afterEach } from '@jest/globals';

jest.unstable_mockModule('../../../src/db/index.js', () => ({
  query: jest.fn(),
}));

jest.unstable_mockModule('../../../src/entities/Modelo.js', () => ({
  Modelo: {
    validate: jest.fn((input) => input),
    validatePartial: jest.fn((input) => input),
  }
}));

const { query } = await import('../../../src/db/index.js');
const { Modelo } = await import('../../../src/entities/Modelo.js');
const {
  listarModelos,
  listarModelosDisponiveis,
  buscarModeloPorId,
  criarModelo,
  atualizarModelo,
  deletarModelo
} = await import('../../../src/services/modelo.service.js');

describe('Modelo Service', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('listarModelos', () => {
    it('deve listar todos os modelos se nenhum tipo for informado', async () => {
      const mockRows = [{ id: 1, nome: 'Civic', marca: 'Honda', tipo_carro_id: 1 }];
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: mockRows });

      const result = await listarModelos();

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY m.marca ASC'), []);
      expect(result).toEqual(mockRows);
    });

    it('deve filtrar modelos pelo tipo de carro se informado', async () => {
      const mockRows = [{ id: 1, nome: 'Civic', marca: 'Honda', tipo_carro_id: 1 }];
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: mockRows });

      const result = await listarModelos(1);

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE m.tipo_carro_id = $1'), [1]);
      expect(result).toEqual(mockRows);
    });
  });

  describe('listarModelosDisponiveis', () => {
    const dataInicio = new Date('2023-01-01');
    const dataFim = new Date('2023-01-10');

    it('deve listar modelos disponíveis no período sem filtro de filial', async () => {
      const mockRows = [{ id: 1, nome: 'Civic', marca: 'Honda' }];
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: mockRows });

      const result = await listarModelosDisponiveis(dataInicio, dataFim);

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE v.status IN (\'DISPONIVEL\', \'ALUGADO\')'),
        [dataInicio, dataFim]
      );
      expect(result).toEqual(mockRows);
    });

    it('deve listar modelos disponíveis filtrando por filial', async () => {
      const mockRows = [{ id: 1, nome: 'Civic', marca: 'Honda' }];
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: mockRows });

      const result = await listarModelosDisponiveis(dataInicio, dataFim, 'filial-1');

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('AND v.filial_id = $3'),
        [dataInicio, dataFim, 'filial-1']
      );
      expect(result).toEqual(mockRows);
    });
  });

  describe('buscarModeloPorId', () => {
    it('deve retornar null se modelo não for encontrado', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });

      const result = await buscarModeloPorId(999);

      expect(query).toHaveBeenCalledTimes(1);
      expect(result).toBeNull();
    });

    it('deve retornar detalhes do modelo se encontrado', async () => {
      const mockRow = { id: 1, nome: 'Civic', marca: 'Honda' };
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [mockRow] });

      const result = await buscarModeloPorId(1);

      expect(query).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockRow);
    });
  });

  describe('criarModelo', () => {
    it('deve lançar erro se o tipo de carro não existir', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rowCount: 0 }); // SELECT tipo_carro

      const input = { nome: 'Civic', marca: 'Honda', tipo_carro_id: 999 };
      await expect(criarModelo(input)).rejects.toThrow('Tipo de carro não encontrado: tipo_carro_id inválido.');

      expect(Modelo.validate).toHaveBeenCalledWith(input);
      expect(query).toHaveBeenCalledTimes(1); // Somente a validação rodou
    });

    it('deve criar e retornar o novo modelo', async () => {
      const input = { nome: 'Civic', marca: 'Honda', tipo_carro_id: 1 };
      const mockRow = { id: 1, ...input };

      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rowCount: 1 }) // SELECT tipo_carro existe
        .mockResolvedValueOnce({ rows: [mockRow] }); // INSERT

      const result = await criarModelo(input);

      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenLastCalledWith(
        expect.stringContaining('INSERT INTO modelo'),
        ['Civic', 'Honda', 1]
      );
      expect(result).toEqual(mockRow);
    });
  });

  describe('atualizarModelo', () => {
    it('deve retornar null se nenhum dado for passado', async () => {
      const result = await atualizarModelo(1, {});

      expect(Modelo.validatePartial).toHaveBeenCalledWith({});
      expect(query).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('deve lançar erro se o novo tipo_carro_id não existir', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rowCount: 0 }); // SELECT tipo_carro

      const input = { tipo_carro_id: 999 };
      await expect(atualizarModelo(1, input)).rejects.toThrow('Tipo de carro não encontrado: tipo_carro_id inválido.');

      expect(query).toHaveBeenCalledTimes(1); // Somente validação
    });

    it('deve atualizar apenas os campos informados e retornar o modelo', async () => {
      const input = { nome: 'Civic Touring' };
      const mockRow = { id: 1, nome: 'Civic Touring', marca: 'Honda', tipo_carro_id: 1 };

      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [mockRow] }); // UPDATE

      const result = await atualizarModelo(1, input);

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE modelo SET nome = $1'),
        ['Civic Touring', 1]
      );
      expect(result).toEqual(mockRow);
    });

    it('deve validar tipo_carro_id e atualizar o modelo', async () => {
      const input = { tipo_carro_id: 2, marca: 'Honda' };
      const mockRow = { id: 1, nome: 'Civic', marca: 'Honda', tipo_carro_id: 2 };

      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rowCount: 1 }) // SELECT tipo_carro
        .mockResolvedValueOnce({ rows: [mockRow] }); // UPDATE

      const result = await atualizarModelo(1, input);

      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenLastCalledWith(
        expect.stringContaining('UPDATE modelo SET marca = $1, tipo_carro_id = $2'),
        ['Honda', 2, 1]
      );
      expect(result).toEqual(mockRow);
    });
  });

  describe('deletarModelo', () => {
    it('deve lançar erro se existirem veículos vinculados ao modelo', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rowCount: 1 }); // SELECT veículos

      await expect(deletarModelo(1)).rejects.toThrow('Não é possível remover: existem veículos ativos vinculados a este modelo.');

      expect(query).toHaveBeenCalledTimes(1);
    });

    it('deve deletar o modelo se não houver dependentes', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rowCount: 0 }) // SELECT veículos
        .mockResolvedValueOnce({ rowCount: 1 }); // DELETE

      const result = await deletarModelo(1);

      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenLastCalledWith(
        expect.stringContaining('DELETE FROM modelo'),
        [1]
      );
      expect(result).toBe(true);
    });
  });
});
