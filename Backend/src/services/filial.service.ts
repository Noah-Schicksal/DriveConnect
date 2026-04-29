import { query } from '../db/index.js';
import type { Caller } from '../middlewares/auth.js';

// ──────────────────────────────────────────────
// Interfaces de retorno seguro (sem dados sensíveis)
// ──────────────────────────────────────────────

export interface FilialPublica {
  id: string;
  nome: string | null;
  cidade: string | null;
  uf: string | null;
  bairro: string | null;
  ativo: boolean;
}

export interface FilialDetalhada extends FilialPublica {
  cep: string | null;
  rua: string | null;
  numero: string | null;
  complemento: string | null;
  criadoEm: Date;
}

export interface GerenteResumo {
  id: string;
  usuarioId: string;
  nomeCompleto: string;
  filialId: string | null;
  criadoEm: Date;
}

// ──────────────────────────────────────────────
// FILIAIS — Leitura (qualquer gerente pode ver)
// ──────────────────────────────────────────────

/** Lista todas as filiais ativas. Dados públicos (sem endereço completo). */
async function _listarFiliais(): Promise<FilialPublica[]> {
  const r = await query(
    `SELECT id, nome, cidade, uf, bairro, ativo
     FROM filial
     WHERE deletado_em IS NULL
     ORDER BY nome`,
  );

  return r.rows.map((row) => ({
    id: row.id,
    nome: row.nome,
    cidade: row.cidade,
    uf: row.uf,
    bairro: row.bairro,
    ativo: row.ativo,
  }));
}

export async function listarFiliais(): Promise<FilialPublica[]> {
  return _listarFiliais();
}

/** Busca uma filial por ID com endereço completo. Qualquer gerente pode ler. */
async function _buscarFilialPorId(filialId: string): Promise<FilialDetalhada | null> {
  const r = await query(
    `SELECT id, nome, cep, uf, cidade, bairro, rua, numero, complemento, ativo, criado_em
     FROM filial
     WHERE id = $1 AND deletado_em IS NULL`,
    [filialId],
  );

  const row = r.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    nome: row.nome,
    cep: row.cep,
    uf: row.uf,
    cidade: row.cidade,
    bairro: row.bairro,
    rua: row.rua,
    numero: row.numero,
    complemento: row.complemento,
    ativo: row.ativo,
    criadoEm: row.criado_em,
  };
}

export async function buscarFilialPorId(filialId: string): Promise<FilialDetalhada | null> {
  return _buscarFilialPorId(filialId);
}

// ──────────────────────────────────────────────
// FILIAIS — Criação (apenas ADMIN)
// ──────────────────────────────────────────────

interface CriarFilialParams {
  nome: string;
  cep?: string;
  uf?: string;
  cidade?: string;
  bairro?: string;
  rua?: string;
  numero?: string;
  complemento?: string;
}

/**
 * Cria uma nova filial. Apenas ADMIN pode criar.
 */
async function _criarFilial(params: CriarFilialParams): Promise<FilialDetalhada> {
  if (!params.nome || params.nome.trim().length < 2) {
    throw new Error('Campo obrigatório inválido: nome deve ter ao menos 2 caracteres.');
  }

  const r = await query(
    `INSERT INTO filial (nome, cep, uf, cidade, bairro, rua, numero, complemento)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      params.nome.trim(),
      params.cep ?? null,
      params.uf ?? null,
      params.cidade ?? null,
      params.bairro ?? null,
      params.rua ?? null,
      params.numero ?? null,
      params.complemento ?? null,
    ],
  );

  return _buscarFilialPorId(r.rows[0].id) as Promise<FilialDetalhada>;
}

export async function criarFilial(params: CriarFilialParams): Promise<FilialDetalhada> {
  return _criarFilial(params);
}

// ──────────────────────────────────────────────
// FILIAIS — Escrita (apenas gerente dono da filial ou ADMIN)
// ──────────────────────────────────────────────

interface AtualizarFilialParams {
  nome?: string;
  cep?: string;
  uf?: string;
  cidade?: string;
  bairro?: string;
  rua?: string;
  numero?: string;
  complemento?: string;
}

/**
 * Atualiza dados de uma filial.
 * Regra: gerente só pode editar sua própria filial; ADMIN pode editar qualquer uma.
 */
async function _atualizarFilial(
  filialId: string,
  caller: Caller,
  params: AtualizarFilialParams,
): Promise<FilialDetalhada | null> {
  // Enforce de ownership no service (regra de negócio, não só HTTP)
  if (caller.tipo === 'GERENTE' && caller.filialId !== filialId) {
    throw new Error('Sem permissão: você só pode alterar dados da sua própria filial.');
  }

  const campos: string[] = [];
  const valores: unknown[] = [];
  let idx = 1;

  if (params.nome        !== undefined) { campos.push(`nome = $${idx++}`);        valores.push(params.nome); }
  if (params.cep         !== undefined) { campos.push(`cep = $${idx++}`);         valores.push(params.cep); }
  if (params.uf          !== undefined) { campos.push(`uf = $${idx++}`);          valores.push(params.uf); }
  if (params.cidade      !== undefined) { campos.push(`cidade = $${idx++}`);      valores.push(params.cidade); }
  if (params.bairro      !== undefined) { campos.push(`bairro = $${idx++}`);      valores.push(params.bairro); }
  if (params.rua         !== undefined) { campos.push(`rua = $${idx++}`);         valores.push(params.rua); }
  if (params.numero      !== undefined) { campos.push(`numero = $${idx++}`);      valores.push(params.numero); }
  if (params.complemento !== undefined) { campos.push(`complemento = $${idx++}`); valores.push(params.complemento); }

  if (campos.length === 0) return null;

  valores.push(filialId);
  await query(
    `UPDATE filial SET ${campos.join(', ')} WHERE id = $${idx} AND deletado_em IS NULL`,
    valores as any[],
  );

  return _buscarFilialPorId(filialId);
}

export async function atualizarFilial(
  filialId: string,
  caller: Caller,
  params: AtualizarFilialParams,
): Promise<FilialDetalhada | null> {
  return _atualizarFilial(filialId, caller, params);
}

// ──────────────────────────────────────────────
// FILIAIS — Soft delete (apenas ADMIN)
// ──────────────────────────────────────────────

/**
 * Desativa (soft delete) uma filial.
 * Rejeita se houver veículos ativos ou gerentes vinculados.
 */
async function _desativarFilial(filialId: string): Promise<boolean> {
  const veiculosAtivos = await query(
    `SELECT id FROM veiculo
     WHERE filial_id = $1 AND deletado_em IS NULL LIMIT 1`,
    [filialId],
  );
  if ((veiculosAtivos.rowCount ?? 0) > 0) {
    throw new Error('Não é possível desativar: existem veículos ativos nesta filial.');
  }

  const gerentesVinculados = await query(
    `SELECT id FROM gerente
     WHERE filial_id = $1 AND deletado_em IS NULL LIMIT 1`,
    [filialId],
  );
  if ((gerentesVinculados.rowCount ?? 0) > 0) {
    throw new Error('Não é possível desativar: existem gerentes vinculados a esta filial.');
  }

  const r = await query(
    `UPDATE filial
     SET deletado_em = CURRENT_TIMESTAMP, ativo = FALSE
     WHERE id = $1 AND deletado_em IS NULL
     RETURNING id`,
    [filialId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function desativarFilial(filialId: string): Promise<boolean> {
  return _desativarFilial(filialId);
}

// ──────────────────────────────────────────────
// GERENTES — Leitura (ADMIN pode ver tudo)
// ──────────────────────────────────────────────

/** Lista todos os gerentes ativos. Apenas ADMIN. */
async function _listarGerentes(): Promise<GerenteResumo[]> {
  const r = await query(
    `SELECT g.id, g.usuario_id, g.nome_completo, g.filial_id, g.criado_em
     FROM gerente g
     JOIN usuario u ON u.id = g.usuario_id
     WHERE g.deletado_em IS NULL AND u.deletado_em IS NULL
     ORDER BY g.nome_completo`,
  );

  return r.rows.map((row) => ({
    id: row.id,
    usuarioId: row.usuario_id,
    nomeCompleto: row.nome_completo,
    filialId: row.filial_id,
    criadoEm: row.criado_em,
  }));
}

export async function listarGerentes(): Promise<GerenteResumo[]> {
  return _listarGerentes();
}

/** Busca o próprio perfil de gerente pelo usuarioId. */
async function _buscarMeuPerfilGerente(usuarioId: string): Promise<GerenteResumo | null> {
  const r = await query(
    `SELECT g.id, g.usuario_id, g.nome_completo, g.filial_id, g.criado_em
     FROM gerente g
     WHERE g.usuario_id = $1 AND g.deletado_em IS NULL`,
    [usuarioId],
  );

  const row = r.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    usuarioId: row.usuario_id,
    nomeCompleto: row.nome_completo,
    filialId: row.filial_id,
    criadoEm: row.criado_em,
  };
}

export async function buscarMeuPerfilGerente(usuarioId: string): Promise<GerenteResumo | null> {
  return _buscarMeuPerfilGerente(usuarioId);
}
