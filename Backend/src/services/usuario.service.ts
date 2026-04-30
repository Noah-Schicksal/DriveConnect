import { query, getClient } from '../db/index.js';
import { gerarHash, verificarHash } from '../utils/hash.js';
import { Usuario } from '../entities/Usuario.js';
import type { TipoUsuario } from '../entities/Usuario.js';
import { Cliente } from '../entities/Cliente.js';
import { Gerente } from '../entities/Gerente.js';

import crypto from 'crypto';

// ──────────────────────────────────────────────
// AUTENTICAÇÃO
// ──────────────────────────────────────────────

export interface LoginPayload {
  email: string;
  senha: string;
}

export interface UsuarioAutenticado {
  id: string;
  email: string;
  tipo: TipoUsuario;
  perfilId: string | null;
}

/**
 * Autentica um usuário verificando email e senha (argon2id).
 * Retorna os dados públicos sem expor o hash.
 */
export async function autenticarUsuario(payload: LoginPayload): Promise<UsuarioAutenticado> {
  const resultado = await query(
    `SELECT id, email, senha, tipo FROM usuario WHERE email = $1 AND deletado_em IS NULL`,
    [payload.email],
  );

  const row = resultado.rows[0];
  if (!row) throw new Error('Credenciais inválidas.');

  const senhaCorreta = await verificarHash(row.senha, payload.senha);
  if (!senhaCorreta) throw new Error('Credenciais inválidas.');

  const perfilId = await buscarPerfilId(row.id, row.tipo);

  return { id: row.id, email: row.email, tipo: row.tipo, perfilId };
}

async function buscarPerfilId(usuarioId: string, tipo: TipoUsuario): Promise<string | null> {
  if (tipo === 'CLIENTE') {
    const r = await query(`SELECT id FROM cliente WHERE usuario_id = $1`, [usuarioId]);
    return r.rows[0]?.id ?? null;
  }
  if (tipo === 'GERENTE') {
    const r = await query(`SELECT id FROM gerente WHERE usuario_id = $1`, [usuarioId]);
    return r.rows[0]?.id ?? null;
  }
  return null; // ADMIN não tem perfil separado
}

// ──────────────────────────────────────────────
// CRIAÇÃO DE USUÁRIO (usuario + perfil em transação)
// ──────────────────────────────────────────────

interface CriarClienteParams {
  email: string;
  senha: string;
  nomeCompleto: string;
  cpf: string;
  rg?: string;
  cnh?: string;
}

interface CriarGerenteParams {
  email: string;
  senha: string;
  nomeCompleto: string;
  filialId?: string;
}

/**
 * Cria usuário do tipo CLIENTE junto ao perfil em uma única transação.
 * Todas as validações de domínio são executadas pelas entidades antes de tocar o banco.
 */
export async function criarCliente(params: CriarClienteParams): Promise<{ usuarioId: string; clienteId: string }> {
  Usuario.validarEmail(params.email);
  Usuario.validarSenha(params.senha);
  Cliente.validarNome(params.nomeCompleto);
  Cliente.validarCpf(params.cpf);

  const senhaHash = await gerarHash(params.senha);
  const client = await getClient();

  try {
    await client.query('BEGIN');

    const usuarioRes = await client.query(
      `INSERT INTO usuario (email, senha, tipo) VALUES ($1, $2, 'CLIENTE') RETURNING id`,
      [params.email, senhaHash],
    );
    const usuarioId: string = usuarioRes.rows[0].id;

    const clienteRes = await client.query(
      `INSERT INTO cliente (usuario_id, nome_completo, cpf, rg, cnh) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [usuarioId, params.nomeCompleto, params.cpf, params.rg ?? null, params.cnh ?? null],
    );
    const clienteId: string = clienteRes.rows[0].id;

    await client.query('COMMIT');
    return { usuarioId, clienteId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cria usuário do tipo GERENTE junto ao perfil em uma única transação.
 */
export async function criarGerente(params: CriarGerenteParams): Promise<{ usuarioId: string; gerenteId: string }> {
  Usuario.validarEmail(params.email);
  Usuario.validarSenha(params.senha);
  Cliente.validarNome(params.nomeCompleto); // reutiliza validação de nome mínimo

  const senhaHash = await gerarHash(params.senha);
  const client = await getClient();

  try {
    await client.query('BEGIN');

    const usuarioRes = await client.query(
      `INSERT INTO usuario (email, senha, tipo) VALUES ($1, $2, 'GERENTE') RETURNING id`,
      [params.email, senhaHash],
    );
    const usuarioId: string = usuarioRes.rows[0].id;

    const gerenteRes = await client.query(
      `INSERT INTO gerente (usuario_id, nome_completo, filial_id) VALUES ($1, $2, $3) RETURNING id`,
      [usuarioId, params.nomeCompleto, params.filialId ?? null],
    );
    const gerenteId: string = gerenteRes.rows[0].id;

    await client.query('COMMIT');
    return { usuarioId, gerenteId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ──────────────────────────────────────────────
// LEITURA
// ──────────────────────────────────────────────

/** Busca um usuário ativo por ID, sem expor o hash de senha. */
export async function buscarUsuarioPorId(id: string): Promise<Usuario | null> {
  const r = await query(
    `SELECT id, email, tipo, criado_em, deletado_em FROM usuario WHERE id = $1`,
    [id],
  );

  const row = r.rows[0];
  if (!row) return null;

  return new Usuario({
    id: row.id,
    email: row.email,
    tipo: row.tipo,
    criadoEm: row.criado_em,
    deletadoEm: row.deletado_em,
  });
}

/** Lista todos os clientes ativos com seus dados de perfil. */
export async function listarClientes(): Promise<Cliente[]> {
  const r = await query(
    `SELECT c.id, c.usuario_id, c.nome_completo, c.cpf, c.rg, c.cnh, c.criado_em, c.deletado_em
     FROM cliente c
     JOIN usuario u ON u.id = c.usuario_id
     WHERE c.deletado_em IS NULL AND u.deletado_em IS NULL
     ORDER BY c.nome_completo`,
  );

  return r.rows.map(
    (row) =>
      new Cliente({
        id: row.id,
        usuarioId: row.usuario_id,
        nomeCompleto: row.nome_completo,
        cpf: row.cpf,
        rg: row.rg,
        cnh: row.cnh,
        criadoEm: row.criado_em,
        deletadoEm: row.deletado_em,
      }),
  );
}

/** Busca um cliente ativo por ID com seus dados de perfil. */
export async function buscarClientePorId(clienteId: string): Promise<Cliente | null> {
  const r = await query(
    `SELECT c.id, c.usuario_id, c.nome_completo, c.cpf, c.rg, c.cnh, c.criado_em, c.deletado_em
     FROM cliente c
     JOIN usuario u ON u.id = c.usuario_id
     WHERE c.id = $1 AND c.deletado_em IS NULL AND u.deletado_em IS NULL`,
    [clienteId],
  );

  const row = r.rows[0];
  if (!row) return null;

  return new Cliente({
    id: row.id,
    usuarioId: row.usuario_id,
    nomeCompleto: row.nome_completo,
    cpf: row.cpf,
    rg: row.rg,
    cnh: row.cnh,
    criadoEm: row.criado_em,
    deletadoEm: row.deletado_em,
  });
}

/** Busca o perfil do próprio cliente usando o usuarioId do caller. */
export async function buscarMeuPerfilCliente(usuarioId: string): Promise<Cliente | null> {
  const r = await query(
    `SELECT c.id, c.usuario_id, c.nome_completo, c.cpf, c.rg, c.cnh, c.criado_em, c.deletado_em
     FROM cliente c
     JOIN usuario u ON u.id = c.usuario_id
     WHERE c.usuario_id = $1 AND c.deletado_em IS NULL AND u.deletado_em IS NULL`,
    [usuarioId],
  );

  const row = r.rows[0];
  if (!row) return null;

  return new Cliente({
    id: row.id,
    usuarioId: row.usuario_id,
    nomeCompleto: row.nome_completo,
    cpf: row.cpf,
    rg: row.rg,
    cnh: row.cnh,
    criadoEm: row.criado_em,
    deletadoEm: row.deletado_em,
  });
}

interface AtualizarMeuPerfilParams {
  nomeCompleto?: string;
  rg?: string;
  cnh?: string;
}

/** Atualiza o perfil do próprio cliente. Só permite alterar nome, rg e cnh. */
export async function atualizarMeuPerfilCliente(
  usuarioId: string,
  params: AtualizarMeuPerfilParams,
): Promise<Cliente | null> {
  if (params.nomeCompleto) Cliente.validarNome(params.nomeCompleto);

  const campos: string[] = [];
  const valores: unknown[] = [];
  let idx = 1;

  if (params.nomeCompleto !== undefined) { campos.push(`nome_completo = $${idx++}`); valores.push(params.nomeCompleto); }
  if (params.rg           !== undefined) { campos.push(`rg = $${idx++}`);            valores.push(params.rg); }
  if (params.cnh          !== undefined) { campos.push(`cnh = $${idx++}`);           valores.push(params.cnh); }

  if (campos.length === 0) return null;

  valores.push(usuarioId);
  await query(
    `UPDATE cliente SET ${campos.join(', ')} WHERE usuario_id = $${idx} AND deletado_em IS NULL`,
    valores as any[],
  );

  return buscarMeuPerfilCliente(usuarioId);
}

// ──────────────────────────────────────────────
// ATUALIZAÇÃO
// ──────────────────────────────────────────────

interface AtualizarClienteParams {
  nomeCompleto?: string;
  rg?: string;
  cnh?: string;
}

/** Atualiza dados do perfil do cliente (não permite alterar email/senha por aqui). */
export async function atualizarCliente(
  clienteId: string,
  params: AtualizarClienteParams,
): Promise<Cliente | null> {
  if (params.nomeCompleto) Cliente.validarNome(params.nomeCompleto);

  const campos: string[] = [];
  const valores: unknown[] = [];
  let idx = 1;

  if (params.nomeCompleto !== undefined) { campos.push(`nome_completo = $${idx++}`); valores.push(params.nomeCompleto); }
  if (params.rg !== undefined)           { campos.push(`rg = $${idx++}`);            valores.push(params.rg); }
  if (params.cnh !== undefined)          { campos.push(`cnh = $${idx++}`);           valores.push(params.cnh); }

  if (campos.length === 0) return null;

  valores.push(clienteId);
  await query(
    `UPDATE cliente SET ${campos.join(', ')} WHERE id = $${idx} AND deletado_em IS NULL`,
    valores as any[],
  );

  return buscarClientePorId(clienteId);
}

/** Troca de senha — valida nova senha e regrava o hash argon2id. */
export async function alterarSenha(usuarioId: string, novaSenha: string): Promise<void> {
  Usuario.validarSenha(novaSenha);
  const novoHash = await gerarHash(novaSenha);

  await query(
    `UPDATE usuario SET senha = $1 WHERE id = $2 AND deletado_em IS NULL`,
    [novoHash, usuarioId],
  );
}

// ──────────────────────────────────────────────
// RECUPERAÇÃO DE SENHA
// ──────────────────────────────────────────────

export async function esqueciSenha(email: string): Promise<string | null> {
  // 1. Busca o usuário
  const r = await query(`SELECT id FROM usuario WHERE email = $1 AND deletado_em IS NULL`, [email]);
  const user = r.rows[0];
  if (!user) return null; // Não retorna erro para não expor quem tem conta

  // 2. Gera token e expiração (1 hora)
  const resetToken = crypto.randomBytes(32).toString('hex');
  const expiraEm = new Date(Date.now() + 60 * 60 * 1000);

  // 3. Salva no banco
  await query(
    `UPDATE usuario SET reset_token = $1, reset_token_expira_em = $2 WHERE id = $3`,
    [resetToken, expiraEm, user.id]
  );

  return resetToken;
}

export async function redefinirSenhaComToken(token: string, novaSenha: string): Promise<void> {
  Usuario.validarSenha(novaSenha);

  // 1. Busca usuário pelo token
  const r = await query(
    `SELECT id, reset_token_expira_em FROM usuario WHERE reset_token = $1 AND deletado_em IS NULL`,
    [token]
  );
  const user = r.rows[0];

  if (!user) {
    throw new Error('Token inválido ou expirado.');
  }

  // 2. Verifica se expirou
  if (new Date() > new Date(user.reset_token_expira_em)) {
    throw new Error('O token de recuperação expirou. Solicite um novo.');
  }

  // 3. Atualiza a senha e invalida o token
  const novoHash = await gerarHash(novaSenha);
  await query(
    `UPDATE usuario SET senha = $1, reset_token = NULL, reset_token_expira_em = NULL WHERE id = $2`,
    [novoHash, user.id]
  );
}

// ──────────────────────────────────────────────
// SOFT DELETE
// ──────────────────────────────────────────────

/** Soft-delete do usuário e do perfil (cliente ou gerente) em transação. */
export async function desativarUsuario(usuarioId: string): Promise<void> {
  const usuarioRow = await query(
    `SELECT tipo FROM usuario WHERE id = $1 AND deletado_em IS NULL`,
    [usuarioId],
  );

  if (!usuarioRow.rows[0]) throw new Error('Usuário não encontrado ou já desativado.');

  const tipo: TipoUsuario = usuarioRow.rows[0].tipo;
  const client = await getClient();

  try {
    await client.query('BEGIN');
    await client.query(`UPDATE usuario SET deletado_em = NOW() WHERE id = $1`, [usuarioId]);

    if (tipo === 'CLIENTE') {
      await client.query(`UPDATE cliente SET deletado_em = NOW() WHERE usuario_id = $1`, [usuarioId]);
    } else if (tipo === 'GERENTE') {
      await client.query(`UPDATE gerente SET deletado_em = NOW() WHERE usuario_id = $1`, [usuarioId]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
