import { jest, describe, it, expect, afterEach } from '@jest/globals';

jest.unstable_mockModule('../../../src/db/index.js', () => ({
  query: jest.fn(),
}));

const { query } = await import('../../../src/db/index.js');
const {
  listarReservas,
  buscarReservaPorId,
  cancelarReserva
} = await import('../../../src/services/reservaConsulta.service.js');

type Caller = {
  usuarioId: string;
  tipo: string;
  filialId: string | null;
};

describe('ReservaConsulta Service', () => {
  const adminCaller: Caller = { usuarioId: '1', tipo: 'ADMIN', filialId: null };
  const gerenteLocalCaller: Caller = { usuarioId: '2', tipo: 'GERENTE', filialId: 'filial-1' };
  const gerenteGlobalCaller: Caller = { usuarioId: '3', tipo: 'GERENTE', filialId: null };
  const clienteCaller: Caller = { usuarioId: 'u1', tipo: 'CLIENTE', filialId: null };

  const mockDbRow = {
    id: 'res-1',
    cliente_id: 'c1',
    cliente_nome: 'Joao',
    veiculo_id: 'v1',
    veiculo_placa: 'ABC1234',
    modelo_nome: 'Honda Civic',
    filial_retirada_id: 'f1',
    filial_retirada_nome: 'Filial A',
    filial_devolucao_id: 'f2',
    filial_devolucao_nome: 'Filial B',
    data_inicio: new Date('2023-01-01'),
    data_fim: new Date('2023-01-05'),
    data_retirada_real: null,
    data_devolucao_real: null,
    valor_total: '1000.00',
    valor_adicional: '50.00',
    status: 'RESERVADA',
    metodo_pagamento: 'PIX',
    pagamento_em: new Date('2022-12-30'),
    plano_seguro_nome: 'Basico',
    valor_seguro: '100.00',
    criado_em: new Date('2022-12-29')
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('listarReservas', () => {
    it('deve retornar todas as reservas sem filtro de filial para ADMIN', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [mockDbRow] });

      const result = await listarReservas(adminCaller);

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(
        expect.not.stringContaining('r.filial_retirada_id ='),
        []
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('res-1');
      expect(result[0].clienteNome).toBe('Joao');
      expect(result[0].valorTotal).toBe(1000);
      expect(result[0].valorAdicional).toBe(50);
      expect(result[0].valorSeguro).toBe(100);
    });

    it('deve aplicar filtro de filial para GERENTE local', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });

      await listarReservas(gerenteLocalCaller);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('(r.filial_retirada_id = $1 OR r.filial_devolucao_id = $1)'),
        ['filial-1']
      );
    });

    it('deve ignorar filtro de filial para GERENTE global', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });

      await listarReservas(gerenteGlobalCaller);

      expect(query).toHaveBeenCalledWith(
        expect.not.stringContaining('r.filial_retirada_id ='),
        []
      );
    });

    it('deve aplicar filtros adicionais de status e cliente', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });

      await listarReservas(adminCaller, 'ATIVA', 'cliente-abc');

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('AND r.status = $1 AND r.cliente_id = $2'),
        ['ATIVA', 'cliente-abc']
      );
    });
  });

  describe('buscarReservaPorId', () => {
    it('deve retornar null se não encontrar', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });
      const result = await buscarReservaPorId('res-1', adminCaller);
      expect(result).toBeNull();
    });

    it('deve retornar a reserva mapeada se encontrar', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [mockDbRow] });
      const result = await buscarReservaPorId('res-1', adminCaller);
      expect(result?.id).toBe('res-1');
    });

    it('deve aplicar os filtros de filial do GERENTE ao buscar por ID', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [mockDbRow] });
      await buscarReservaPorId('res-1', gerenteLocalCaller);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('AND r.id = $2'),
        ['filial-1', 'res-1']
      );
    });
  });

  describe('cancelarReserva', () => {
    const mockReservaDb = {
      id: 'res-1',
      status: 'RESERVADA',
      veiculo_id: 'v1',
      cliente_id: 'c1',
      cliente_usuario_id: 'u1',
      filial_retirada_id: 'filial-1',
      filial_devolucao_id: 'filial-2'
    };

    it('deve lançar erro se reserva não existir', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });
      await expect(cancelarReserva('res-1', adminCaller)).rejects.toThrow('Reserva não encontrada.');
    });

    it('deve lançar erro se CLIENTE tentar cancelar reserva de outro cliente', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [{ ...mockReservaDb, cliente_usuario_id: 'outro-user' }] });
      await expect(cancelarReserva('res-1', clienteCaller)).rejects.toThrow('Sem permissão: esta reserva não pertence a você.');
    });

    it('deve lançar erro se GERENTE tentar cancelar reserva de outra filial', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [{ ...mockReservaDb, filial_retirada_id: 'outra', filial_devolucao_id: 'outra' }] });
      await expect(cancelarReserva('res-1', gerenteLocalCaller)).rejects.toThrow('Sem permissão: esta reserva não pertence à sua filial.');
    });

    it('deve lançar erro se reserva não for cancelável (ex: ATIVA)', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [{ ...mockReservaDb, status: 'ATIVA' }] });
      await expect(cancelarReserva('res-1', adminCaller))
        .rejects.toThrow('Somente reservas PENDENTE_PAGAMENTO ou RESERVADA podem ser canceladas.');
    });

    it('deve liberar o veículo e cancelar a reserva se o status for RESERVADA', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rows: [mockReservaDb] }) // buscar reserva
        .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE veiculo
        .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE reserva

      await cancelarReserva('res-1', adminCaller);

      expect(query).toHaveBeenCalledTimes(3);
      expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining("UPDATE veiculo SET status = 'DISPONIVEL'"), ['v1']);
      expect(query).toHaveBeenNthCalledWith(3, expect.stringContaining("UPDATE reserva SET status = 'CANCELADA'"), ['res-1']);
    });

    it('deve apenas cancelar a reserva se o status for PENDENTE_PAGAMENTO (veículo não precisa voltar)', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rows: [{ ...mockReservaDb, status: 'PENDENTE_PAGAMENTO' }] }) // buscar reserva
        .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE reserva

      await cancelarReserva('res-1', adminCaller);

      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining("UPDATE reserva SET status = 'CANCELADA'"), ['res-1']);
    });
  });
});
