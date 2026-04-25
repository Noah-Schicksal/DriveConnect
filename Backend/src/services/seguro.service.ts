import { query } from '../db/index.js';

// ──────────────────────────────────────────────
// TIPOS
// ──────────────────────────────────────────────

export interface PlanoSeguro {
  id: string;
  franquia_id: string;
  nome: string;
  descricao: string | null;
  percentual: number;
  obrigatorio: boolean;
  ativo: boolean;
}

interface CriarPlanoParams {
  franquiaId: string;
  nome: string;
  descricao?: string;
  percentual: number;
  obrigatorio?: boolean;
}

// ──────────────────────────────────────────────
// CONSULTAS
// ──────────────────────────────────────────────

/**
 * Lista todos os planos ativos de uma locadora.
 * O plano obrigatório (Básico) sempre aparece primeiro.
 */
export async function listarPlanosDaLocadora(franquiaId: string): Promise<PlanoSeguro[]> {
  const resultado = await query(
    `SELECT id, franquia_id, nome, descricao, percentual, obrigatorio, ativo
     FROM plano_seguro
     WHERE franquia_id = $1
       AND ativo = TRUE
       AND deletado_em IS NULL
     ORDER BY obrigatorio DESC, percentual ASC`,
    [franquiaId],
  );

  return resultado.rows.map((r) => ({
    ...r,
    percentual: Number(r.percentual),
  }));
}

/**
 * Busca o plano obrigatório (Básico) de uma locadora.
 * Lança erro se a locadora não tiver um plano básico configurado.
 */
export async function buscarPlanoBasico(franquiaId: string): Promise<PlanoSeguro> {
  const resultado = await query(
    `SELECT id, franquia_id, nome, descricao, percentual, obrigatorio, ativo
     FROM plano_seguro
     WHERE franquia_id = $1
       AND obrigatorio = TRUE
       AND ativo = TRUE
       AND deletado_em IS NULL
     LIMIT 1`,
    [franquiaId],
  );

  if (!resultado.rows[0]) {
    throw new Error(`Locadora ${franquiaId} não possui um plano de seguro básico configurado.`);
  }

  return { ...resultado.rows[0], percentual: Number(resultado.rows[0].percentual) };
}

/**
 * Busca um plano específico, validando que pertence à locadora informada.
 * Garante que um cliente não possa usar o plano de outra locadora.
 */
export async function buscarPlanoPorId(planoId: string, franquiaId: string): Promise<PlanoSeguro | null> {
  const resultado = await query(
    `SELECT id, franquia_id, nome, descricao, percentual, obrigatorio, ativo
     FROM plano_seguro
     WHERE id = $1
       AND franquia_id = $2
       AND ativo = TRUE
       AND deletado_em IS NULL`,
    [planoId, franquiaId],
  );

  if (!resultado.rows[0]) return null;

  return { ...resultado.rows[0], percentual: Number(resultado.rows[0].percentual) };
}

// ──────────────────────────────────────────────
// CÁLCULO
// ──────────────────────────────────────────────

/**
 * Calcula o valor do seguro para uma reserva.
 * Fórmula: valor_aluguel × (percentual / 100)
 * O resultado é arredondado para 2 casas decimais.
 */
export function calcularValorSeguro(percentual: number, valorAluguel: number): number {
  return Math.round(valorAluguel * (percentual / 100) * 100) / 100;
}

// ──────────────────────────────────────────────
// CRUD (uso pela locadora)
// ──────────────────────────────────────────────

/**
 * Cria um novo plano de seguro para uma locadora.
 * A constraint do banco garante que não existirá mais de 1 plano obrigatório.
 */
export async function criarPlano(params: CriarPlanoParams): Promise<PlanoSeguro> {
  const resultado = await query(
    `INSERT INTO plano_seguro (franquia_id, nome, descricao, percentual, obrigatorio)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      params.franquiaId,
      params.nome,
      params.descricao ?? null,
      params.percentual,
      params.obrigatorio ?? false,
    ],
  );

  return { ...resultado.rows[0], percentual: Number(resultado.rows[0].percentual) };
}

/**
 * Atualiza nome, descrição ou percentual de um plano.
 * Não é possível alterar o campo `obrigatorio` por aqui (protege a integridade).
 */
export async function atualizarPlano(
  planoId: string,
  franquiaId: string,
  dados: { nome?: string; descricao?: string; percentual?: number },
): Promise<PlanoSeguro | null> {
  const campos: string[] = [];
  const valores: unknown[] = [];
  let indice = 1;

  if (dados.nome !== undefined) { campos.push(`nome = $${indice++}`); valores.push(dados.nome); }
  if (dados.descricao !== undefined) { campos.push(`descricao = $${indice++}`); valores.push(dados.descricao); }
  if (dados.percentual !== undefined) { campos.push(`percentual = $${indice++}`); valores.push(dados.percentual); }

  if (campos.length === 0) return null;

  valores.push(planoId, franquiaId);

  const resultado = await query(
    `UPDATE plano_seguro
     SET ${campos.join(', ')}
     WHERE id = $${indice++} AND franquia_id = $${indice} AND deletado_em IS NULL
     RETURNING *`,
    valores,
  );

  if (!resultado.rows[0]) return null;
  return { ...resultado.rows[0], percentual: Number(resultado.rows[0].percentual) };
}

/**
 * Desativa (soft delete) um plano de seguro.
 * Planos obrigatórios não podem ser desativados — protege a integridade do fluxo.
 */
export async function desativarPlano(planoId: string, franquiaId: string): Promise<{ sucesso: boolean; motivo?: string }> {
  // Verifica se é o plano obrigatório
  const plano = await query(
    `SELECT obrigatorio FROM plano_seguro WHERE id = $1 AND franquia_id = $2 AND deletado_em IS NULL`,
    [planoId, franquiaId],
  );

  if (!plano.rows[0]) return { sucesso: false, motivo: 'Plano não encontrado.' };
  if (plano.rows[0].obrigatorio) {
    return { sucesso: false, motivo: 'O plano obrigatório (Básico) não pode ser desativado.' };
  }

  await query(
    `UPDATE plano_seguro SET ativo = FALSE, deletado_em = NOW() WHERE id = $1 AND franquia_id = $2`,
    [planoId, franquiaId],
  );

  return { sucesso: true };
}
