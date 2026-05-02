import { jest, describe, it, expect, afterEach } from '@jest/globals';

jest.unstable_mockModule('../../../src/db/index.js', () => ({
  query: jest.fn(),
}));

const { query } = await import('../../../src/db/index.js');
const {
  criarVeiculo,
  listarVeiculos,
  buscarVeiculoPorId,
  adicionarImagemVeiculo,
  atualizarVeiculo,
  deletarVeiculo
} = await import('../../../src/services/veiculo.service.js');

describe('Veiculo Service', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  const mockVeiculoDb = {
    id: 'v1',
    modelo_id: 2,
    filial_id: 'filial-1',
    placa: 'ABC-1234',
    ano: 2022,
    cor: 'Preto',
    status: 'DISPONIVEL',
    imagem_url: 'padrao.jpg'
  };

  describe('criarVeiculo', () => {
    it('deve inserir o veículo no banco de dados e retornar a linha criada', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [mockVeiculoDb] });

      const input = {
        modelo_id: 2,
        filial_id: 'filial-1',
        placa: 'ABC-1234',
        ano: 2022,
        cor: 'Preto',
        status: 'DISPONIVEL',
        imagem_url: 'padrao.jpg'
      } as any;

      const result = await criarVeiculo(input);

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO veiculo'),
        [2, 'filial-1', 'ABC-1234', 2022, 'Preto', 'DISPONIVEL', 'padrao.jpg']
      );
      expect(result).toEqual(mockVeiculoDb);
    });
  });

  describe('listarVeiculos', () => {
    it('deve listar todos os veículos sem filtro de filial', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [mockVeiculoDb] });

      const result = await listarVeiculos();

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(
        expect.not.stringContaining('AND v.filial_id = $1'),
        []
      );
      expect(result).toHaveLength(1);
    });

    it('deve adicionar o filtro de filial quando parametrizado', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });

      await listarVeiculos('filial-teste');

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('AND v.filial_id = $1'),
        ['filial-teste']
      );
    });
  });

  describe('buscarVeiculoPorId', () => {
    it('deve retornar null se o veículo não existir', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });

      const result = await buscarVeiculoPorId('v1');

      expect(query).toHaveBeenCalledTimes(1); // parou no primeiro SQL
      expect(result).toBeNull();
    });

    it('deve retornar o veículo preenchido com suas respectivas imagens', async () => {
      const mockImagens = [
        { filename: 'img1.jpg', is_principal: true },
        { filename: 'img2.jpg', is_principal: false }
      ];

      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rows: [mockVeiculoDb] }) // SQL de veiculo
        .mockResolvedValueOnce({ rows: mockImagens });    // SQL de imagens

      const result = await buscarVeiculoPorId('v1');

      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenLastCalledWith(
        expect.stringContaining('SELECT * FROM veiculo_imagem WHERE veiculo_id = $1'),
        ['v1']
      );
      expect(result.id).toBe('v1');
      expect(result.imagens).toEqual(mockImagens);
    });
  });

  describe('adicionarImagemVeiculo', () => {
    it('deve apenas inserir a imagem se isPrincipal for falso', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rowCount: 1 });

      await adicionarImagemVeiculo('v1', 'foto1.jpg', false);

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO veiculo_imagem'),
        ['v1', 'foto1.jpg', false]
      );
    });

    it('deve invalidar as imagens principais anteriores antes de inserir se isPrincipal for verdadeiro', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE
        .mockResolvedValueOnce({ rowCount: 1 }); // INSERT

      await adicionarImagemVeiculo('v1', 'foto2.jpg', true);

      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenNthCalledWith(1,
        expect.stringContaining('UPDATE veiculo_imagem SET is_principal = FALSE'),
        ['v1']
      );
      expect(query).toHaveBeenNthCalledWith(2,
        expect.stringContaining('INSERT INTO veiculo_imagem'),
        ['v1', 'foto2.jpg', true]
      );
    });
  });

  describe('atualizarVeiculo', () => {
    it('deve retornar null sem rodar query se os dados estiverem vazios', async () => {
      const result = await atualizarVeiculo('v1', {});

      expect(query).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('deve omitir a chave id do body da atualização e montar as cláusulas corretamente', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [{ ...mockVeiculoDb, cor: 'Branco', placa: 'DEF-5678' }] });

      const result = await atualizarVeiculo('v1', { id: 'v1', cor: 'Branco', placa: 'DEF-5678' } as any);

      expect(query).toHaveBeenCalledTimes(1);
      // As cláusulas SET devem estar construídas a partir do paramIdx = 1 e v1 no paramIdx = 3
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE veiculo \n    SET cor = $1, placa = $2 \n    WHERE id = $3'),
        ['Branco', 'DEF-5678', 'v1']
      );
      expect(result?.cor).toBe('Branco');
    });

    it('deve retornar null se o registro não for encontrado ou já estiver deletado', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });

      const result = await atualizarVeiculo('v2', { cor: 'Branco' });

      expect(result).toBeNull();
    });
  });

  describe('deletarVeiculo', () => {
    it('deve retornar falso se não houver linha afetada', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rowCount: 0 });

      const result = await deletarVeiculo('v2');

      expect(result).toBe(false);
    });

    it('deve executar o soft delete e retornar verdadeiro', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rowCount: 1 });

      const result = await deletarVeiculo('v1');

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE veiculo SET deletado_em = CURRENT_TIMESTAMP WHERE id = $1'),
        ['v1']
      );
      expect(result).toBe(true);
    });
  });
});
