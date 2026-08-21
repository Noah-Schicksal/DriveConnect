/**
 * Tools — Funções que a IA pode chamar para acessar dados reais e executar ações.
 * Cada tool retorna um objeto estruturado com sucesso, dados e metadados.
 */

import { query } from '../db/index.js';
import { criarReservaPendente } from '../services/reserva.service.js';
import { buscarClientePorId } from '../services/usuario.service.js';
import type { Caller } from '../middlewares/auth.js';

// TIPOS
export type ToolResult<T = any> = {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: Record<string, any>;
};

// TOOL 1: LISTAR FILIAIS
export interface FilialInfo {
  id: string;
  nome: string;
  cidade: string;
  uf: string;
  endereco: string;
  telefone?: string;
  horario?: string;
  ativo: boolean;
}

export async function toolListarFiliais(): Promise<ToolResult<FilialInfo[]>> {
  try {
    const result = await query(
      `SELECT 
        id, nome, cidade, uf,
        CONCAT(rua, ', ', numero, ' - ', bairro) AS endereco,
        ativo
       FROM filial 
       WHERE deletado_em IS NULL AND ativo = TRUE
       ORDER BY cidade, nome`,
    );

    const seen = new Set<string>();
    const filiais = result.rows
      .map((r) => ({
        id: String(r.id),
        nome: String(r.nome),
        cidade: String(r.cidade),
        uf: String(r.uf),
        endereco: String(r.endereco || ''),
        ativo: Boolean(r.ativo),
      }))
      .filter((filial) => {
        const chave = `${filial.nome}::${filial.cidade}::${filial.uf}::${filial.endereco}`.toLowerCase();
        if (seen.has(chave)) return false;
        seen.add(chave);
        return true;
      });

    return {
      success: true,
      data: filiais,
      metadata: { total: filiais.length },
    };
  } catch (err) {
    return {
      success: false,
      error: `Erro ao listar filiais: ${err instanceof Error ? err.message : 'desconhecido'}`,
    };
  }
}

// TOOL 2: LISTAR CARROS DISPONÍVEIS (COM VALIDAÇÃO REAL)
export interface CarroDisponivel {
  id: string;
  placa: string;
  modelo: string;
  marca: string;
  categoria: string;
  ano: number;
  cor: string;
  filial_id: string;
  filial_nome: string;
  preco_diaria: number;
  status: string;
  imagem_url?: string;
}

export async function toolListarCarrosDisponiveis(params: {
  filial_id?: string;
  categoria?: string;
  data_inicio?: string;
  data_fim?: string;
}): Promise<ToolResult<CarroDisponivel[]>> {
  try {
    const { filial_id, categoria, data_inicio, data_fim } = params;

    // Validação de datas
    if (data_inicio && data_fim) {
      const inicio = new Date(data_inicio);
      const fim = new Date(data_fim);
      if (isNaN(inicio.getTime()) || isNaN(fim.getTime())) {
        return { success: false, error: 'Datas inválidas (use formato ISO: YYYY-MM-DD)' };
      }
      if (fim <= inicio) {
        return { success: false, error: 'Data fim deve ser posterior à data início' };
      }
    }

    let sql = `
      SELECT 
        v.id, v.placa, v.ano, v.cor, v.status,
        v.filial_id, v.preco_diaria,
        (SELECT filename FROM veiculo_imagem WHERE veiculo_id = v.id ORDER BY is_principal DESC LIMIT 1) AS imagem_url,
        m.nome AS modelo, m.marca, m.tipo_carro_id,
        tc.nome AS categoria,
        f.nome AS filial_nome
      FROM veiculo v
      JOIN modelo m ON m.id = v.modelo_id
      JOIN tipo_carro tc ON tc.id = m.tipo_carro_id
      JOIN filial f ON f.id = v.filial_id
      WHERE v.deletado_em IS NULL
        AND f.deletado_em IS NULL
        AND f.ativo = TRUE
        AND v.status = 'DISPONIVEL'
    `;

    const values: any[] = [];
    let paramIdx = 1;

    if (filial_id) {
      sql += ` AND v.filial_id = $${paramIdx++}`;
      values.push(filial_id);
    }

    if (categoria) {
      sql += ` AND LOWER(tc.nome) LIKE LOWER($${paramIdx++})`;
      values.push(`%${categoria}%`);
    }

    // Se houver período, verifica conflitos de reserva
    if (data_inicio && data_fim) {
      sql += `
        AND NOT EXISTS (
          SELECT 1 FROM reserva r
          WHERE r.veiculo_id = v.id
            AND r.status IN ('PENDENTE_PAGAMENTO', 'RESERVADA', 'ATIVA')
            AND r.data_inicio < $${paramIdx + 1}
            AND r.data_fim > $${paramIdx}
            AND r.deletado_em IS NULL
        )
      `;
      values.push(data_inicio, data_fim);
      paramIdx += 2;
    }

    sql += ` ORDER BY v.placa ASC LIMIT 20`;

    const result = await query(sql, values);

    const carros = result.rows.map((r) => ({
      id: String(r.id),
      placa: String(r.placa),
      modelo: String(r.modelo),
      marca: String(r.marca),
      categoria: String(r.categoria),
      ano: Number(r.ano),
      cor: String(r.cor),
      filial_id: String(r.filial_id),
      filial_nome: String(r.filial_nome),
      preco_diaria: Number(r.preco_diaria),
      status: String(r.status),
      imagem_url: r.imagem_url ? String(r.imagem_url) : undefined,
    }));

    return {
      success: true,
      data: carros,
      metadata: {
        total: carros.length,
        filtros_aplicados: { filial_id, categoria, data_inicio, data_fim },
      },
    };
  } catch (err) {
    return {
      success: false,
      error: `Erro ao listar carros: ${err instanceof Error ? err.message : 'desconhecido'}`,
    };
  }
}

// TOOL 3: VALIDAR DISPONIBILIDADE ESPECÍFICA
export interface ValidacaoDisponibilidade {
  disponivel: boolean;
  motivo?: string;
  veiculo?: {
    id: string;
    placa: string;
    modelo: string;
  };
}

export async function toolValidarDisponibilidade(params: {
  veiculo_id: string;
  data_inicio: string;
  data_fim: string;
}): Promise<ToolResult<ValidacaoDisponibilidade>> {
  try {
    const { veiculo_id, data_inicio, data_fim } = params;

    // Validar datas
    const inicio = new Date(data_inicio);
    const fim = new Date(data_fim);
    if (isNaN(inicio.getTime()) || isNaN(fim.getTime())) {
      return { success: false, error: 'Datas inválidas' };
    }
    if (fim <= inicio) {
      return { success: false, error: 'Data fim deve ser posterior à data início' };
    }

    // Verificar status do veículo
    const veiculoRes = await query(
      `SELECT id, placa, status FROM veiculo WHERE id = $1 AND deletado_em IS NULL`,
      [veiculo_id],
    );

    if (!veiculoRes.rows[0]) {
      return {
        success: true,
        data: { disponivel: false, motivo: 'Veículo não encontrado' },
      };
    }

    const veiculo = veiculoRes.rows[0];
    if (veiculo.status !== 'DISPONIVEL') {
      return {
        success: true,
        data: {
          disponivel: false,
          motivo: `Veículo em status ${veiculo.status}`,
          veiculo: {
            id: String(veiculo.id),
            placa: String(veiculo.placa),
            modelo: '',
          },
        },
      };
    }

    // Verificar conflitos de reserva
    const conflito = await query(
      `SELECT COUNT(*) as cnt FROM reserva
       WHERE veiculo_id = $1
         AND status IN ('PENDENTE_PAGAMENTO', 'RESERVADA', 'ATIVA')
         AND data_inicio < $3
         AND data_fim > $2
         AND deletado_em IS NULL`,
      [veiculo_id, data_inicio, data_fim],
    );

    const temConflito = Number(conflito.rows[0]?.cnt || 0) > 0;

    return {
      success: true,
      data: {
        disponivel: !temConflito,
        motivo: temConflito ? 'Veículo já possui reserva no período' : undefined,
        veiculo: {
          id: String(veiculo.id),
          placa: String(veiculo.placa),
          modelo: veiculo.modelo || '',
        },
      },
    };
  } catch (err) {
    return {
      success: false,
      error: `Erro ao validar disponibilidade: ${err instanceof Error ? err.message : 'desconhecido'}`,
    };
  }
}

// TOOL 4: CRIAR RESERVA
export interface ReservaResult {
  reserva_id: string;
  link_pagamento?: string;
  valor_total: number;
  status: string;
  mensagem: string;
}

export async function toolCriarReserva(params: {
  cliente_id: string;
  veiculo_id: string;
  filial_retirada_id: string;
  filial_devolucao_id?: string;
  data_inicio: string;
  data_fim: string;
  plano_seguro_id?: string;
  metodo_pagamento?: string;
}): Promise<ToolResult<ReservaResult>> {
  try {
    const {
      cliente_id,
      veiculo_id,
      filial_retirada_id,
      filial_devolucao_id,
      data_inicio,
      data_fim,
      plano_seguro_id,
      metodo_pagamento,
    } = params;

    // Validar cliente
    const clienteRes = await query(
      `SELECT c.id, c.nome_completo, u.email, c.telefone, m.nome, m.marca
       FROM cliente c
       JOIN usuario u ON u.id = c.usuario_id
       JOIN veiculo v ON v.id = $2
       JOIN modelo m ON m.id = v.modelo_id
       WHERE c.id = $1 AND c.deletado_em IS NULL AND u.deletado_em IS NULL`,
      [cliente_id, veiculo_id],
    );

    if (!clienteRes.rows[0]) {
      return { success: false, error: 'Cliente não encontrado ou inválido' };
    }

    const cliente = clienteRes.rows[0];

    // Validar datas
    const inicio = new Date(data_inicio);
    const fim = new Date(data_fim);
    if (isNaN(inicio.getTime()) || isNaN(fim.getTime()) || fim <= inicio) {
      return { success: false, error: 'Datas inválidas' };
    }

    // Validar disponibilidade NOVAMENTE (proteção contra race condition)
    const validacao = await toolValidarDisponibilidade({
      veiculo_id,
      data_inicio,
      data_fim,
    });

    if (!validacao.success || !validacao.data?.disponivel) {
      return {
        success: false,
        error: validacao.data?.motivo || 'Veículo não está disponível',
      };
    }

    // Chamar serviço de criação de reserva
    const { calcularValorTotal } = await import('../services/reserva.service.js');
    const valorAluguel = await calcularValorTotal(
      parseInt(veiculo_id, 10),
      filial_retirada_id,
      inicio,
      fim,
    );

    const reserva = await criarReservaPendente({
      clienteId: cliente_id,
      veiculoId: (veiculo_id as any),
      filialRetiradaId: filial_retirada_id,
      filialDevolucaoId: filial_devolucao_id || filial_retirada_id,
      dataInicio: inicio,
      dataFim: fim,
      valorAluguel,
      nomeCliente: cliente.nome_completo,
      emailCliente: cliente.email,
      telefoneCliente: cliente.telefone,
      descricaoModelo: `${cliente.marca || ''} ${cliente.nome}`.trim(),
      planoSeguroId: plano_seguro_id,
      metodoPagamento: metodo_pagamento || 'INFINITEPAY',
      origem: 'WHATSAPP_AI',
    });

    return {
      success: true,
      data: {
        reserva_id: reserva.reservaId,
        link_pagamento: reserva.linkPagamento,
        valor_total: reserva.valorTotal,
        status: reserva.status,
        mensagem: `Reserva criada! Abra este link para pagar: ${reserva.linkPagamento || 'Link será gerado'}`,
      },
      metadata: { valor_seguro: reserva.valorSeguro, plano: reserva.planoSeguro },
    };
  } catch (err) {
    return {
      success: false,
      error: `Erro ao criar reserva: ${err instanceof Error ? err.message : 'desconhecido'}`,
    };
  }
}

// TOOL 5: OBTER DETALHES DE RESERVA
export interface ReservaDetalhes {
  id: string;
  cliente_nome: string;
  modelo: string;
  data_inicio: string;
  data_fim: string;
  valor_total: number;
  status: string;
  link_pagamento?: string;
  imagem_url?: string;
  placa?: string;
  cor?: string;
}

export async function toolObterReserva(
  reserva_id: string,
): Promise<ToolResult<ReservaDetalhes>> {
  try {
    const result = await query(
      `SELECT 
        r.id, r.status, r.data_inicio, r.data_fim, r.valor_total, r.link_pagamento,
        c.nome_completo, m.nome, m.marca, v.placa, v.cor,
        (SELECT filename FROM veiculo_imagem WHERE veiculo_id = v.id ORDER BY is_principal DESC LIMIT 1) AS imagem_url
       FROM reserva r
       JOIN cliente c ON c.id = r.cliente_id
       JOIN veiculo v ON v.id = r.veiculo_id
       JOIN modelo m ON m.id = v.modelo_id
       WHERE r.id = $1 AND r.deletado_em IS NULL`,
      [reserva_id],
    );

    if (!result.rows[0]) {
      return { success: false, error: 'Reserva não encontrada' };
    }

    const r = result.rows[0];
    return {
      success: true,
      data: {
        id: String(r.id),
        cliente_nome: String(r.nome_completo),
        modelo: `${r.marca || ''} ${r.nome}`.trim(),
        data_inicio: String(r.data_inicio),
        data_fim: String(r.data_fim),
        valor_total: Number(r.valor_total),
        status: String(r.status),
        link_pagamento: r.link_pagamento ? String(r.link_pagamento) : undefined,
        imagem_url: r.imagem_url ? String(r.imagem_url) : undefined,
        placa: r.placa ? String(r.placa) : undefined,
        cor: r.cor ? String(r.cor) : undefined,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: `Erro ao obter reserva: ${err instanceof Error ? err.message : 'desconhecido'}`,
    };
  }
}

// TOOL 6: REGISTRAR CLIENTE (AUTO-SIGN-UP)
export interface ClienteRegistrado {
  cliente_id: string;
  usuario_id: string;
  nome: string;
  email: string;
}

export async function toolRegistrarCliente(params: {
  nome_completo: string;
  email: string;
  cpf: string;
  telefone?: string;
}): Promise<ToolResult<ClienteRegistrado>> {
  try {
    const { nome_completo, email, cpf, telefone } = params;

    // Validar CPF básico
    if (!/^\d{3}\.\d{3}\.\d{3}-\d{2}$|^\d{11}$/.test(cpf)) {
      return { success: false, error: 'CPF inválido' };
    }

    // Verificar se cliente já existe
    const existente = await query(
      `SELECT c.id, u.email FROM cliente c JOIN usuario u ON u.id = c.usuario_id WHERE c.cpf = $1`,
      [cpf],
    );

    if (existente.rows[0]) {
      return {
        success: true,
        data: {
          cliente_id: String(existente.rows[0].id),
          usuario_id: '',
          nome: nome_completo,
          email: String(existente.rows[0].email),
        },
        metadata: { novo: false, mensagem: 'Cliente já cadastrado' },
      };
    }

    // Gerar senha aleatória (cliente confirmará por email depois)
    const { criarCliente } = await import('../services/usuario.service.js');
    const senhaTemporaria = Math.random().toString(36).slice(-12);

    const resultado = await criarCliente({
      email,
      senha: senhaTemporaria,
      nomeCompleto: nome_completo,
      cpf,
      telefone,
    });

    return {
      success: true,
      data: {
        cliente_id: resultado.clienteId,
        usuario_id: resultado.usuarioId,
        nome: nome_completo,
        email,
      },
      metadata: { novo: true, mensagem: 'Cliente registrado com sucesso' },
    };
  } catch (err) {
    return {
      success: false,
      error: `Erro ao registrar cliente: ${err instanceof Error ? err.message : 'desconhecido'}`,
    };
  }
}

// TOOL 7: OBTER FOTOS DO VEÍCULO
export interface FotoVeiculo {
  veiculo_id: string;
  placa: string;
  modelo: string;
  fotos: Array<{
    url: string;
    principal: boolean;
  }>;
}

export async function toolObterFotosVeiculo(
  veiculo_id: string,
): Promise<ToolResult<FotoVeiculo>> {
  try {
    const veiculoRes = await query(
      `SELECT v.id, v.placa, m.nome, m.marca
       FROM veiculo v
       JOIN modelo m ON m.id = v.modelo_id
       WHERE v.id = $1 AND v.deletado_em IS NULL`,
      [veiculo_id],
    );

    if (!veiculoRes.rows[0]) {
      return { success: false, error: 'Veículo não encontrado' };
    }

    const fotosRes = await query(
      `SELECT filename, is_principal FROM veiculo_imagem 
       WHERE veiculo_id = $1 
       ORDER BY is_principal DESC, criado_em ASC`,
      [veiculo_id],
    );

    if (fotosRes.rows.length === 0) {
      return {
        success: false,
        error: 'Este veículo não possui fotos disponíveis',
      };
    }

    const v = veiculoRes.rows[0];
    return {
      success: true,
      data: {
        veiculo_id: String(v.id),
        placa: String(v.placa),
        modelo: `${v.marca} ${v.nome}`.trim(),
        fotos: fotosRes.rows.map((f) => ({
          url: String(f.filename),
          principal: Boolean(f.is_principal),
        })),
      },
      metadata: { total_fotos: fotosRes.rows.length },
    };
  } catch (err) {
    return {
      success: false,
      error: `Erro ao obter fotos: ${err instanceof Error ? err.message : 'desconhecido'}`,
    };
  }
}

// MAPA DE TOOLS (para Agent)
export const TOOLS_MAP = {
  listar_filiais: {
    name: 'listar_filiais',
    description: 'Lista todas as filiais ativas com endereço e informações de contato',
    func: toolListarFiliais,
    params: {},
  },
  listar_carros_disponiveis: {
    name: 'listar_carros_disponiveis',
    description:
      'Lista a frota de carros de uma filial ou categoria. Se as datas NÃO forem fornecidas, lista o catálogo geral da filial. Se as datas FOREM fornecidas, filtra por disponibilidade real (sem conflitos). Use para responder "quais carros vocês têm?", "ver veículos da filial X", etc.',
    func: toolListarCarrosDisponiveis,
    params: {
      filial_id: 'UUID da filial (opcional)',
      categoria: 'Nome da categoria: Econômico, SUV, Premium, Sedan, etc (opcional)',
      data_inicio: 'Data de retirada (YYYY-MM-DD, opcional)',
      data_fim: 'Data de devolução (YYYY-MM-DD, opcional)',
    },
  },
  validar_disponibilidade: {
    name: 'validar_disponibilidade',
    description: 'Valida se um veículo específico está realmente disponível para um período',
    func: toolValidarDisponibilidade,
    params: {
      veiculo_id: 'UUID do veículo',
      data_inicio: 'Data de retirada (YYYY-MM-DD)',
      data_fim: 'Data de devolução (YYYY-MM-DD)',
    },
  },
  criar_reserva: {
    name: 'criar_reserva',
    description:
      'Cria uma nova reserva pendente de pagamento. Validação automática de disponibilidade. Retorna link de pagamento InfinitePay.',
    func: toolCriarReserva,
    params: {
      cliente_id: 'UUID do cliente',
      veiculo_id: 'UUID do veículo',
      filial_retirada_id: 'UUID da filial de retirada',
      filial_devolucao_id: 'UUID da filial de devolução (opcional)',
      data_inicio: 'Data de retirada (YYYY-MM-DD)',
      data_fim: 'Data de devolução (YYYY-MM-DD)',
      plano_seguro_id: 'UUID do plano (opcional)',
      metodo_pagamento: 'INFINITEPAY ou DINHEIRO (opcional)',
    },
  },
  obter_reserva: {
    name: 'obter_reserva',
    description: 'Obtém detalhes e status de uma reserva existente',
    func: toolObterReserva,
    params: {
      reserva_id: 'UUID da reserva',
    },
  },
  obter_fotos_veiculo: {
    name: 'obter_fotos_veiculo',
    description: 'Obtém todas as fotos disponíveis de um veículo específico',
    func: toolObterFotosVeiculo,
    params: {
      veiculo_id: 'UUID do veículo',
    },
  },
  registrar_cliente: {
    name: 'registrar_cliente',
    description: 'Registra um novo cliente no sistema (auto sign-up via WhatsApp)',
    func: toolRegistrarCliente,
    params: {
      nome_completo: 'Nome completo do cliente',
      email: 'Email do cliente',
      cpf: 'CPF (XXX.XXX.XXX-XX ou 11 dígitos)',
      telefone: 'Telefone (opcional)',
    },
  },
};

export type ToolName = keyof typeof TOOLS_MAP;

/**
 * Executa uma tool por nome com parâmetros
 */
export async function executeTool(
  toolName: ToolName,
  params: any,
): Promise<ToolResult> {
  const tool = TOOLS_MAP[toolName];
  if (!tool) {
    return { success: false, error: `Tool desconhecida: ${toolName}` };
  }
  try {
    return await tool.func(params);
  } catch (err) {
    return {
      success: false,
      error: `Erro ao executar ${toolName}: ${err instanceof Error ? err.message : 'desconhecido'}`,
    };
  }
}
