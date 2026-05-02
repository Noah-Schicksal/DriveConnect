import { jest, describe, it, expect, afterEach, beforeEach } from '@jest/globals';

// Mocks de Banco e Utils de Hash
const mockClient = {
  query: jest.fn(),
  release: jest.fn()
};

jest.unstable_mockModule('../../../src/db/index.js', () => ({
  query: jest.fn(),
  getClient: jest.fn(() => Promise.resolve(mockClient))
}));

jest.unstable_mockModule('../../../src/utils/hash.js', () => ({
  gerarHash: jest.fn(),
  verificarHash: jest.fn()
}));

const { query, getClient } = await import('../../../src/db/index.js');
const { gerarHash, verificarHash } = await import('../../../src/utils/hash.js');
const {
  autenticarUsuario,
  criarCliente,
  criarGerente,
  buscarUsuarioPorId,
  listarClientes,
  buscarClientePorId,
  buscarMeuPerfilCliente,
  atualizarMeuPerfilCliente,
  atualizarCliente,
  alterarSenha,
  esqueciSenha,
  redefinirSenhaComToken,
  desativarUsuario
} = await import('../../../src/services/usuario.service.js');

describe('Usuario Service', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockClient.query.mockReset();
    (gerarHash as jest.Mock).mockReset();
  });

  describe('autenticarUsuario', () => {
    const payload = { email: 'teste@email.com', senha: '123' };

    it('deve lançar erro se o email não for encontrado', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });

      await expect(autenticarUsuario(payload)).rejects.toThrow('Credenciais inválidas.');
    });

    it('deve lançar erro se a senha estiver incorreta', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [{ id: 'u1', email: 'teste@email.com', senha: 'hash', tipo: 'CLIENTE' }] });
      (verificarHash as jest.Mock<any>).mockResolvedValueOnce(false);

      await expect(autenticarUsuario(payload)).rejects.toThrow('Credenciais inválidas.');
    });

    it('deve autenticar um ADMIN com perfilId nulo', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [{ id: 'u1', email: 'admin@email.com', senha: 'hash', tipo: 'ADMIN' }] });
      (verificarHash as jest.Mock<any>).mockResolvedValueOnce(true);

      const result = await autenticarUsuario(payload);

      expect(result).toEqual({ id: 'u1', email: 'admin@email.com', tipo: 'ADMIN', perfilId: null });
    });

    it('deve buscar o perfilId se for CLIENTE', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rows: [{ id: 'u1', email: 'c@c.com', senha: 'h', tipo: 'CLIENTE' }] }) // busca user
        .mockResolvedValueOnce({ rows: [{ id: 'cliente-123' }] }); // busca perfil
      (verificarHash as jest.Mock<any>).mockResolvedValueOnce(true);

      const result = await autenticarUsuario(payload);

      expect(result.perfilId).toBe('cliente-123');
    });
  });

  describe('criarCliente', () => {
    const params = { email: 'novo@cli.com', senha: 'SenhaForte123!', nomeCompleto: 'João Silva', cpf: '123.456.789-09' };

    it('deve criar usuário e cliente usando transaction', async () => {
      (gerarHash as jest.Mock<any>).mockResolvedValueOnce('hash-123');
      
      // Mocks sequenciais pro client.query: 
      // 1. BEGIN, 2. INSERT Usuario, 3. INSERT Cliente, 4. COMMIT
      mockClient.query
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ id: 'usuario-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'cliente-1' }] })
        .mockResolvedValueOnce({});

      const result = await criarCliente(params);

      expect(gerarHash).toHaveBeenCalledWith('SenhaForte123!');
      expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
      expect(mockClient.query).toHaveBeenNthCalledWith(2, expect.stringContaining('INSERT INTO usuario'), ['novo@cli.com', 'hash-123']);
      expect(mockClient.query).toHaveBeenNthCalledWith(3, expect.stringContaining('INSERT INTO cliente'), ['usuario-1', 'João Silva', '123.456.789-09', null, null]);
      expect(mockClient.query).toHaveBeenNthCalledWith(4, 'COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
      
      expect(result).toEqual({ usuarioId: 'usuario-1', clienteId: 'cliente-1' });
    });

    it('deve fazer ROLLBACK se der erro no meio da transação', async () => {
      (gerarHash as jest.Mock<any>).mockResolvedValueOnce('hash-123');
      
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('Erro no DB')); // INSERT falha

      await expect(criarCliente(params)).rejects.toThrow('Erro no DB');

      expect(mockClient.query).toHaveBeenLastCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('criarGerente', () => {
    it('deve criar usuário e gerente usando transaction', async () => {
      (gerarHash as jest.Mock<any>).mockResolvedValueOnce('hash-123');
      mockClient.query
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ id: 'usuario-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'gerente-1' }] })
        .mockResolvedValueOnce({});

      const result = await criarGerente({ email: 'g@g.com', senha: 'SenhaForte123!', nomeCompleto: 'Gerente X', filialId: 'filial-1' });

      expect(result).toEqual({ usuarioId: 'usuario-1', gerenteId: 'gerente-1' });
    });
  });

  describe('Consultas (buscarUsuarioPorId, listarClientes, etc)', () => {
    it('buscarUsuarioPorId deve retornar classe de Usuário ou null', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });
      let result = await buscarUsuarioPorId('u1');
      expect(result).toBeNull();

      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [{ id: 'u1', email: 'e', tipo: 'ADMIN' }] });
      result = await buscarUsuarioPorId('u1');
      expect(result?.email).toBe('e');
    });

    it('listarClientes deve mapear e retornar instâncias de Cliente', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [{ id: 'c1', nome_completo: 'Joao', usuario_id: 'u1' }] });
      const result = await listarClientes();
      expect(result).toHaveLength(1);
      expect(result[0].nomeCompleto).toBe('Joao');
    });
  });

  describe('Atualizações de Perfil e Senha', () => {
    it('atualizarMeuPerfilCliente deve validar e dar update no banco', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rowCount: 1 }) // Update
        .mockResolvedValueOnce({ rows: [{ id: 'c1', nome_completo: 'Joao Novo' }] }); // Busca depois de atualizar

      const result = await atualizarMeuPerfilCliente('u1', { nomeCompleto: 'Joao Novo' });

      expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('UPDATE cliente SET nome_completo'), ['Joao Novo', 'u1']);
      expect(result?.nomeCompleto).toBe('Joao Novo');
    });

    it('alterarSenha deve gerar hash novo e salvar', async () => {
      (gerarHash as jest.Mock<any>).mockResolvedValueOnce('hashnovo');
      (query as jest.Mock<any>).mockResolvedValueOnce({});

      await alterarSenha('u1', 'SenhaForteNova1!');

      expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE usuario SET senha = $1'), ['hashnovo', 'u1']);
    });
  });

  describe('Fluxo de Esqueci Senha', () => {
    it('esqueciSenha deve retornar null se não achar email', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });
      const token = await esqueciSenha('nada@nada.com');
      expect(token).toBeNull();
    });

    it('esqueciSenha deve gerar token e salvar no banco', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rows: [{ id: 'u1' }] })
        .mockResolvedValueOnce({});

      const token = await esqueciSenha('teste@teste.com');
      
      expect(token).toBeDefined();
      expect(token?.length).toBe(64); // 32 bytes em hex
      expect(query).toHaveBeenLastCalledWith(expect.stringContaining('UPDATE usuario SET reset_token'), [token, expect.any(Date), 'u1']);
    });

    it('redefinirSenhaComToken deve rejeitar token inválido', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });
      await expect(redefinirSenhaComToken('token-falso', 'SenhaForte123!')).rejects.toThrow('Token inválido ou expirado.');
    });

    it('redefinirSenhaComToken deve rejeitar token expirado', async () => {
      const dataPassada = new Date(Date.now() - 100000);
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [{ id: 'u1', reset_token_expira_em: dataPassada }] });
      await expect(redefinirSenhaComToken('token-vencido', 'SenhaForte123!')).rejects.toThrow('O token de recuperação expirou.');
    });

    it('redefinirSenhaComToken deve aplicar a nova senha e limpar tokens', async () => {
      const dataFutura = new Date(Date.now() + 100000);
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rows: [{ id: 'u1', reset_token_expira_em: dataFutura }] })
        .mockResolvedValueOnce({});
      (gerarHash as jest.Mock<any>).mockResolvedValueOnce('hash-rec');

      await redefinirSenhaComToken('token-valido', 'SenhaForte123!');

      expect(query).toHaveBeenLastCalledWith(
        expect.stringContaining('UPDATE usuario SET senha = $1, reset_token = NULL'),
        ['hash-rec', 'u1']
      );
    });
  });

  describe('desativarUsuario', () => {
    it('deve falhar se não encontrar', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });
      await expect(desativarUsuario('ux')).rejects.toThrow('Usuário não encontrado');
    });

    it('deve desativar cliente e perfil na mesma transação', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [{ tipo: 'CLIENTE' }] });
      mockClient.query.mockResolvedValue({});

      await desativarUsuario('u1');

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE usuario SET deletado_em'), ['u1']);
      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE cliente SET deletado_em'), ['u1']);
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('deve dar ROLLBACK em caso de erro no soft delete', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [{ tipo: 'ADMIN' }] });
      mockClient.query
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('Falha'));

      await expect(desativarUsuario('u1')).rejects.toThrow('Falha');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });
});
