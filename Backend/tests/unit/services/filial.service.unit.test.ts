import { jest, describe, it, expect, afterEach } from '@jest/globals';

// Mock do módulo do banco de dados (Deve vir antes do import do serviço)
jest.unstable_mockModule('../../../src/db/index.js', () => ({
  query: jest.fn(),
}));

const { query } = await import('../../../src/db/index.js');
const {
  listarFiliais,
  buscarFilialPorId,
  criarFilial,
  atualizarFilial,
  desativarFilial,
  listarGerentes,
  buscarMeuPerfilGerente
} = await import('../../../src/services/filial.service.js');

type Caller = {
  usuarioId: string;
  tipo: string;
  filialId: string | null;
};

describe('Filial Service', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('listarFiliais', () => {
    it('deve listar as filiais ativas corretamente', async () => {
      const mockRows = [
        { id: '1', nome: 'Filial A', cidade: 'Cidade A', uf: 'SP', bairro: 'Bairro A', ativo: true },
      ];
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: mockRows });

      const result = await listarFiliais();

      expect(query).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockRows);
    });
  });

  describe('buscarFilialPorId', () => {
    it('deve retornar null se filial não existir', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });

      const result = await buscarFilialPorId('uuid-inexistente');

      expect(result).toBeNull();
    });

    it('deve retornar os detalhes da filial', async () => {
      const mockDate = new Date('2023-01-01');
      const mockRow = {
        id: '1', nome: 'Filial A', cep: '00000-000', uf: 'SP', cidade: 'Cidade A',
        bairro: 'Bairro', rua: 'Rua', numero: '123', complemento: null,
        ativo: true, criado_em: mockDate
      };
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [mockRow] });

      const result = await buscarFilialPorId('1');

      expect(result).toEqual({
        id: mockRow.id,
        nome: mockRow.nome,
        cep: mockRow.cep,
        uf: mockRow.uf,
        cidade: mockRow.cidade,
        bairro: mockRow.bairro,
        rua: mockRow.rua,
        numero: mockRow.numero,
        complemento: mockRow.complemento,
        ativo: mockRow.ativo,
        criadoEm: mockDate,
      });
    });
  });

  describe('criarFilial', () => {
    it('deve lançar erro se o nome tiver menos de 2 caracteres', async () => {
      await expect(criarFilial({ nome: 'A' }))
        .rejects.toThrow('Campo obrigatório inválido: nome deve ter ao menos 2 caracteres.');
    });

    it('deve criar uma nova filial e retornar os detalhes', async () => {
      const mockDate = new Date('2023-01-01');
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rows: [{ id: 'novo-id' }] }) // INSERT
        .mockResolvedValueOnce({ // SELECT
          rows: [{
            id: 'novo-id', nome: 'Nova Filial', cep: null, uf: null, cidade: null,
            bairro: null, rua: null, numero: null, complemento: null,
            ativo: true, criado_em: mockDate
          }]
        });

      const params = { nome: 'Nova Filial' };
      const result = await criarFilial(params);

      expect(query).toHaveBeenCalledTimes(2);
      expect(result?.id).toBe('novo-id');
      expect(result?.nome).toBe('Nova Filial');
    });
  });

  describe('atualizarFilial', () => {
    const adminCaller: Caller = { usuarioId: '1', tipo: 'ADMIN', filialId: null };
    const gerenteCaller: Caller = { usuarioId: '2', tipo: 'GERENTE', filialId: 'filial-1' };

    it('deve lançar erro se GERENTE tentar atualizar filial diferente da sua', async () => {
      await expect(atualizarFilial('outra-filial', gerenteCaller, { nome: 'Novo Nome' }))
        .rejects.toThrow('Sem permissão: você só pode alterar dados da sua própria filial.');
    });

    it('deve retornar null se nenhum campo for passado para atualização', async () => {
      const result = await atualizarFilial('filial-1', adminCaller, {});

      expect(result).toBeNull();
      expect(query).not.toHaveBeenCalled();
    });

    it('deve atualizar dados da filial corretamente e retornar', async () => {
      const mockDate = new Date();
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE
        .mockResolvedValueOnce({ // SELECT
          rows: [{
            id: 'filial-1', nome: 'Novo Nome', cep: '123', uf: null, cidade: null,
            bairro: null, rua: null, numero: null, complemento: null,
            ativo: true, criado_em: mockDate
          }]
        });

      const result = await atualizarFilial('filial-1', adminCaller, { nome: 'Novo Nome', cep: '123' });

      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('UPDATE filial SET'),
        ['Novo Nome', '123', 'filial-1']
      );
      expect(result?.id).toBe('filial-1');
      expect(result?.nome).toBe('Novo Nome');
    });
  });

  describe('desativarFilial', () => {
    it('deve rejeitar se houver veículos ativos', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rowCount: 1 }); // SELECT veículos

      await expect(desativarFilial('filial-1'))
        .rejects.toThrow('Não é possível desativar: existem veículos ativos nesta filial.');
    });

    it('deve rejeitar se houver gerentes vinculados', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rowCount: 0 }) // SELECT veículos
        .mockResolvedValueOnce({ rowCount: 1 }); // SELECT gerentes

      await expect(desativarFilial('filial-1'))
        .rejects.toThrow('Não é possível desativar: existem gerentes vinculados a esta filial.');
    });

    it('deve desativar a filial caso não existam dependências', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rowCount: 0 }) // SELECT veículos
        .mockResolvedValueOnce({ rowCount: 0 }) // SELECT gerentes
        .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE

      const result = await desativarFilial('filial-1');

      expect(query).toHaveBeenCalledTimes(3);
      expect(result).toBe(true);
    });
  });

  describe('listarGerentes', () => {
    it('deve listar gerentes ativos corretamente', async () => {
      const mockDate = new Date();
      const mockRows = [
        { id: '1', usuario_id: 'u1', nome_completo: 'Gerente A', filial_id: 'f1', criado_em: mockDate }
      ];
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: mockRows });

      const result = await listarGerentes();

      expect(query).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
      expect(result[0].nomeCompleto).toBe('Gerente A');
    });
  });

  describe('buscarMeuPerfilGerente', () => {
    it('deve retornar null se gerente não for encontrado', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });

      const result = await buscarMeuPerfilGerente('u-inexistente');

      expect(result).toBeNull();
    });

    it('deve retornar dados do perfil do gerente', async () => {
      const mockDate = new Date();
      const mockRow = { id: '1', usuario_id: 'u1', nome_completo: 'Gerente A', filial_id: 'f1', criado_em: mockDate };
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [mockRow] });

      const result = await buscarMeuPerfilGerente('u1');

      expect(result?.id).toBe('1');
      expect(result?.nomeCompleto).toBe('Gerente A');
    });
  });
});
