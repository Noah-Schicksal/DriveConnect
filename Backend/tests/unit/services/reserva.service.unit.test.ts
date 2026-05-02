import { jest, describe, it, expect, afterEach } from '@jest/globals';

jest.unstable_mockModule('../../../src/db/index.js', () => ({
  query: jest.fn(),
}));

jest.unstable_mockModule('../../../src/services/payment.service.js', () => ({
  gerarLinkPagamento: jest.fn(),
}));

jest.unstable_mockModule('../../../src/services/seguro.service.js', () => ({
  buscarPlanoBasico: jest.fn(),
  buscarPlanoPorId: jest.fn(),
  calcularValorSeguro: jest.fn(),
}));

const { query } = await import('../../../src/db/index.js');
const { gerarLinkPagamento } = await import('../../../src/services/payment.service.js');
const { buscarPlanoBasico, buscarPlanoPorId, calcularValorSeguro } = await import('../../../src/services/seguro.service.js');
const {
  buscarVeiculoDisponivel,
  calcularValorTotal,
  criarReservaPendente,
  confirmarReserva,
  estenderReserva,
  verificarDisponibilidadeRetirada,
  expirarReservasPendentes
} = await import('../../../src/services/reserva.service.js');

type Caller = {
  usuarioId: string;
  tipo: string;
  filialId: string | null;
};

describe('Reserva Service', () => {
  const adminCaller: Caller = { usuarioId: '1', tipo: 'ADMIN', filialId: null };
  const gerenteCaller: Caller = { usuarioId: '2', tipo: 'GERENTE', filialId: 'filial-1' };
  const clienteCaller: Caller = { usuarioId: 'u1', tipo: 'CLIENTE', filialId: null };

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('buscarVeiculoDisponivel', () => {
    it('deve retornar null se não houver veículo disponível', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });

      const result = await buscarVeiculoDisponivel(1, new Date(), new Date());

      expect(query).toHaveBeenCalledTimes(1);
      expect(result).toBeNull();
    });

    it('deve retornar o ID do veículo se houver disponibilidade', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [{ id: 'veiculo-1' }] });

      const result = await buscarVeiculoDisponivel(1, new Date(), new Date());

      expect(result).toBe('veiculo-1');
    });
  });

  describe('calcularValorTotal', () => {
    const dataInicio = new Date('2023-01-01');
    const dataFim = new Date('2023-01-03'); // 2 dias

    it('deve usar o preço dinâmico se existir', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [{ valor_diaria: '150' }] });

      const result = await calcularValorTotal(1, 'filial-1', dataInicio, dataFim);

      expect(query).toHaveBeenCalledTimes(1);
      expect(result).toBe(300); // 150 * 2
    });

    it('deve usar o preço base fallback se não houver preço dinâmico', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rows: [] }) // dinâmico falha
        .mockResolvedValueOnce({ rows: [{ preco_base_diaria: '100' }] }); // fallback funciona

      const result = await calcularValorTotal(1, 'filial-1', dataInicio, dataFim);

      expect(query).toHaveBeenCalledTimes(2);
      expect(result).toBe(200); // 100 * 2
    });
  });

  describe('criarReservaPendente', () => {
    const params = {
      clienteId: 'c1', veiculoId: 'v1', filialRetiradaId: 'f1', filialDevolucaoId: 'f1',
      dataInicio: new Date('2023-01-01'), dataFim: new Date('2023-01-03'),
      valorAluguel: 200, nomeCliente: 'Joao', emailCliente: 'joao@email.com',
      descricaoModelo: 'Carro X'
    };

    it('deve lançar erro em caso de conflito de datas (rowCount 0)', async () => {
      (buscarPlanoBasico as jest.Mock<any>).mockResolvedValueOnce({ id: 'pb', percentual: 10, nome: 'Basico' });
      (calcularValorSeguro as jest.Mock<any>).mockReturnValueOnce(20);
      (query as jest.Mock<any>).mockResolvedValueOnce({ rowCount: 0 }); // falha no insert

      await expect(criarReservaPendente(params))
        .rejects.toThrow('O veículo selecionado não está disponível para o período solicitado (conflito de datas).');
    });

    it('deve criar reserva usando plano básico e gerar link de pagamento', async () => {
      (buscarPlanoBasico as jest.Mock<any>).mockResolvedValueOnce({ id: 'pb', percentual: 10, nome: 'Basico' });
      (calcularValorSeguro as jest.Mock<any>).mockReturnValueOnce(20);
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'reserva-123' }] }) // insert
        .mockResolvedValueOnce({ rowCount: 1 }); // update
      (gerarLinkPagamento as jest.Mock<any>).mockResolvedValueOnce({ link_pagamento: 'http://pag.com', slug: 'slug-1' });

      const result = await criarReservaPendente(params);

      expect(buscarPlanoBasico).toHaveBeenCalled();
      expect(gerarLinkPagamento).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        reservaId: 'reserva-123',
        linkPagamento: 'http://pag.com',
        valorTotal: 220,
        valorSeguro: 20,
        planoSeguro: 'Basico'
      });
    });

    it('deve criar reserva usando plano específico passado', async () => {
      (buscarPlanoPorId as jest.Mock<any>).mockResolvedValueOnce({ id: 'p_esp', percentual: 20, nome: 'Premium' });
      (calcularValorSeguro as jest.Mock<any>).mockReturnValueOnce(40);
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'reserva-123' }] })
        .mockResolvedValueOnce({ rowCount: 1 });
      (gerarLinkPagamento as jest.Mock<any>).mockResolvedValueOnce({ link_pagamento: 'http://pag.com', slug: 'slug-1' });

      const result = await criarReservaPendente({ ...params, planoSeguroId: 'p_esp' });

      expect(buscarPlanoPorId).toHaveBeenCalledWith('p_esp');
      expect(buscarPlanoBasico).not.toHaveBeenCalled();
      expect(result.valorTotal).toBe(240);
      expect(result.planoSeguro).toBe('Premium');
    });
  });

  describe('confirmarReserva', () => {
    it('deve atualizar o banco para status RESERVADA', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rowCount: 1 });

      await confirmarReserva({
        transaction_nsu: 'txn1', capture_method: 'PIX', receipt_url: 'url', order_nsu: 'reserva-1', invoice_slug: 'slug'
      });

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('status = \'RESERVADA\''),
        ['txn1', 'PIX', 'url', 'reserva-1']
      );
    });
  });

  describe('estenderReserva', () => {
    const dataFim = new Date('2023-01-10');
    const novaDataFim = new Date('2023-01-15');
    const mockReserva = { 
      id: 'res-1', veiculo_id: 'v1', status: 'ATIVA', data_inicio: new Date('2023-01-01'), 
      data_fim: dataFim, modelo_id: 1, filial_retirada_id: 'f1', filial_devolucao_id: 'f1',
      cliente_usuario_id: 'u1', plano_seguro_id: 'pb' 
    };

    it('deve lançar erro se reserva não existir', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });
      await expect(estenderReserva('res-1', novaDataFim, adminCaller)).rejects.toThrow('Reserva não encontrada.');
    });

    it('deve lançar erro se CLIENTE tentar estender de outro cliente', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [{ ...mockReserva, cliente_usuario_id: 'outro-user' }] });
      await expect(estenderReserva('res-1', novaDataFim, clienteCaller)).rejects.toThrow('Sem permissão: esta reserva não pertence a você.');
    });

    it('deve lançar erro se data final não for posterior à original', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [mockReserva] });
      await expect(estenderReserva('res-1', new Date('2023-01-05'), adminCaller)).rejects.toThrow('A nova data final deve ser posterior à data final atual.');
    });

    it('deve lançar erro se houver conflito de veículo no novo período', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rows: [mockReserva] }) // select reserva
        .mockResolvedValueOnce({ rowCount: 1 }); // conflito encontrado
      await expect(estenderReserva('res-1', novaDataFim, adminCaller)).rejects.toThrow('O veículo não está disponível para o período estendido (já existe outra reserva em conflito).');
    });

    it('deve estender a reserva e atualizar valor adicional com sucesso', async () => {
      (query as jest.Mock<any>)
        .mockResolvedValueOnce({ rows: [mockReserva] }) // select reserva
        .mockResolvedValueOnce({ rowCount: 0 }) // conflito
        .mockResolvedValueOnce({ rows: [{ valor_diaria: '100' }] }) // calc valor dinâmico = 5 dias * 100 = 500
        .mockResolvedValueOnce({ rowCount: 1 }); // update
        
      (buscarPlanoPorId as jest.Mock<any>).mockResolvedValueOnce({ id: 'pb', percentual: 10 });
      (calcularValorSeguro as jest.Mock<any>).mockReturnValueOnce(50); // 10% de 500

      await estenderReserva('res-1', novaDataFim, adminCaller);

      // Custo extra total = 500 + 50 = 550
      expect(query).toHaveBeenLastCalledWith(
        expect.stringContaining('UPDATE reserva'),
        [novaDataFim, 550, 'res-1']
      );
    });
  });

  describe('verificarDisponibilidadeRetirada', () => {
    it('deve retornar falso se não encontrada', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [] });
      const res = await verificarDisponibilidadeRetirada('r1');
      expect(res.liberado).toBe(false);
    });

    it('deve retornar falso se reserva_status não for RESERVADA', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [{ reserva_status: 'ATIVA', veiculo_status: 'DISPONIVEL' }] });
      const res = await verificarDisponibilidadeRetirada('r1');
      expect(res.liberado).toBe(false);
    });

    it('deve retornar falso se veiculo_status não for DISPONIVEL', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [{ reserva_status: 'RESERVADA', veiculo_status: 'MANUTENCAO' }] });
      const res = await verificarDisponibilidadeRetirada('r1');
      expect(res.liberado).toBe(false);
    });

    it('deve retornar liberado=true', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rows: [{ reserva_status: 'RESERVADA', veiculo_status: 'DISPONIVEL' }] });
      const res = await verificarDisponibilidadeRetirada('r1');
      expect(res.liberado).toBe(true);
    });
  });

  describe('expirarReservasPendentes', () => {
    it('deve expirar e retornar o count', async () => {
      (query as jest.Mock<any>).mockResolvedValueOnce({ rowCount: 3 });
      const res = await expirarReservasPendentes();
      expect(res).toBe(3);
    });
  });
});
