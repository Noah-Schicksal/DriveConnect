import { query, getClient } from '../db/index.js';
import { gerarHash, verificarHash } from '../utils/hash.js';
import { Usuario } from '../entities/Usuario.js';
import type { TipoUsuario } from '../entities/Usuario.js';
import { Cliente } from '../entities/Cliente.js';
import { UsuarioRepository } from '../repositories/usuario.repository.js';
import crypto from 'crypto';
import { notifyNovoCliente } from './fcm.service.js';

export interface LoginPayload {
  email: string;
  senha: string;
}

export interface UsuarioAutenticado {
  id: string;
  email: string;
  tipo: TipoUsuario;
  perfilId: string | null;
  filialId: string | null;
  imagemUrl: string | null;
  preferencias: any;
}

export async function autenticarUsuario(payload: LoginPayload): Promise<UsuarioAutenticado> {
  const row = await UsuarioRepository.findByEmail(payload.email);
  if (!row) throw new Error('Credenciais inválidas.');

  const senhaCorreta = await verificarHash(row.senha, payload.senha);
  if (!senhaCorreta) throw new Error('Credenciais inválidas.');

  let perfilId: string | null = null;
  let filialId: string | null = null;

  if (row.tipo === 'CLIENTE') {
    perfilId = await UsuarioRepository.findPerfilCliente(row.id);
  } else if (row.tipo === 'GERENTE') {
    const perf = await UsuarioRepository.findPerfilGerente(row.id);
    if (perf) {
      perfilId = perf.perfilId;
      filialId = perf.filialId;
    }
  }

  return {
    id: row.id,
    email: row.email,
    tipo: row.tipo,
    perfilId,
    filialId,
    imagemUrl: row.imagem_url,
    preferencias: row.preferencias
  };
}

interface CriarClienteParams {
  email: string;
  senha: string;
  nomeCompleto: string;
  cpf: string;
  rg?: string;
  cnh?: string;
  telefone?: string;
}

interface CriarGerenteParams {
  email: string;
  senha: string;
  nomeCompleto: string;
  filialId?: string;
}

export async function criarCliente(params: CriarClienteParams): Promise<{ usuarioId: string; clienteId: string }> {
  Usuario.validarEmail(params.email);
  Usuario.validarSenha(params.senha);
  Cliente.validarNome(params.nomeCompleto);
  const cpfNormalizado = Cliente.normalizarCpf(params.cpf);

  const senhaHash = await gerarHash(params.senha);
  const client = await getClient();

  try {
    await client.query('BEGIN');

    const usuarioId = await UsuarioRepository.insertUsuario(client, params.email, senhaHash, 'CLIENTE');
    const clienteId = await UsuarioRepository.insertCliente(
      client,
      usuarioId,
      params.nomeCompleto,
      cpfNormalizado,
      params.rg ?? null,
      params.cnh ?? null,
      params.telefone ?? null
    );

    await client.query('COMMIT');
    void notifyNovoCliente({ clienteId, clienteNome: params.nomeCompleto }).catch((err) => {});

    return { usuarioId, clienteId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function criarGerente(params: CriarGerenteParams): Promise<{ usuarioId: string; gerenteId: string }> {
  Usuario.validarEmail(params.email);
  Usuario.validarSenha(params.senha);
  Cliente.validarNome(params.nomeCompleto);

  const senhaHash = await gerarHash(params.senha);
  const client = await getClient();

  try {
    await client.query('BEGIN');

    const usuarioId = await UsuarioRepository.insertUsuario(client, params.email, senhaHash, 'GERENTE');
    const gerenteId = await UsuarioRepository.insertGerente(client, usuarioId, params.nomeCompleto, params.filialId ?? null);

    await client.query('COMMIT');
    return { usuarioId, gerenteId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function buscarUsuarioPorId(id: string): Promise<Usuario | null> {
  const row = await UsuarioRepository.findById(id);
  if (!row) return null;

  return new Usuario({
    id: row.id,
    email: row.email,
    tipo: row.tipo,
    imagemUrl: row.imagem_url,
    preferencias: row.preferencias,
    criadoEm: row.criado_em,
    deletadoEm: row.deletado_em,
  });
}

export async function atualizarFotoPerfil(usuarioId: string, imagemUrl: string): Promise<void> {
  await UsuarioRepository.updateImagemUrl(usuarioId, imagemUrl);
}

export async function atualizarPreferenciasUsuario(usuarioId: string, preferencias: any): Promise<void> {
  await UsuarioRepository.updatePreferencias(usuarioId, preferencias);
}

export async function listarClientes(): Promise<any[]> {
  const r = await query(
    `SELECT 
        c.id, 
        c.usuario_id, 
        c.nome_completo, 
        c.cpf, 
        c.rg, 
        c.cnh, 
        c.criado_em,
        json_build_object(
          'id', u.id,
          'email', u.email,
          'tipo', u.tipo,
          'imagemUrl', u.imagem_url,
          'criado_em', u.criado_em,
          'nome', c.nome_completo,
          'perfilId', c.id
        ) as usuario
     FROM cliente c
     JOIN usuario u ON u.id = c.usuario_id
     WHERE c.deletado_em IS NULL AND u.deletado_em IS NULL
     ORDER BY c.nome_completo`,
  );
  return r.rows;
}

export async function listarUsuariosSistema(): Promise<any[]> {
  const r = await query(
    `SELECT 
        u.id, 
        u.email, 
        u.tipo, 
        u.imagem_url as "imagemUrl",
        u.criado_em,
        COALESCE(c.nome_completo, g.nome_completo, 'Administrador') as nome
     FROM usuario u
     LEFT JOIN cliente c ON c.usuario_id = u.id
     LEFT JOIN gerente g ON g.usuario_id = u.id
     WHERE u.deletado_em IS NULL
     ORDER BY u.tipo, nome`,
  );
  return r.rows;
}

export async function buscarClientePorId(clienteId: string): Promise<any | null> {
  const r = await query(
    `SELECT 
        c.id as perfil_id, 
        c.usuario_id as id, 
        c.nome_completo as nome, 
        c.cpf, c.rg, c.cnh, c.criado_em,
        u.email, u.tipo, u.imagem_url, u.preferencias
     FROM cliente c
     JOIN usuario u ON u.id = c.usuario_id
     WHERE c.id = $1 AND c.deletado_em IS NULL AND u.deletado_em IS NULL`,
    [clienteId],
  );
  return r.rows[0] || null;
}

export async function buscarMeuPerfilCliente(usuarioId: string): Promise<any | null> {
  const r = await query(
    `SELECT 
        c.id as perfil_id, 
        c.usuario_id as id, 
        c.nome_completo as nome, 
        c.cpf, c.rg, c.cnh, c.criado_em,
        u.email, u.tipo, u.imagem_url, u.preferencias
     FROM cliente c
     JOIN usuario u ON u.id = c.usuario_id
     WHERE c.usuario_id = $1 AND c.deletado_em IS NULL AND u.deletado_em IS NULL`,
    [usuarioId],
  );
  return r.rows[0] || null;
}

interface AtualizarMeuPerfilParams {
  nomeCompleto?: string;
  rg?: string;
  cnh?: string;
}

export async function atualizarMeuPerfilCliente(
  usuarioId: string,
  params: AtualizarMeuPerfilParams,
): Promise<any | null> {
  if (params.nomeCompleto) Cliente.validarNome(params.nomeCompleto);

  const campos: string[] = [];
  const valores: unknown[] = [];
  let idx = 1;

  if (params.nomeCompleto !== undefined) { campos.push(`nome_completo = $${idx++}`); valores.push(params.nomeCompleto); }
  if (params.rg !== undefined) { campos.push(`rg = $${idx++}`); valores.push(params.rg); }
  if (params.cnh !== undefined) { campos.push(`cnh = $${idx++}`); valores.push(params.cnh); }

  if (campos.length === 0) return null;

  valores.push(usuarioId);
  await query(
    `UPDATE cliente SET ${campos.join(', ')} WHERE usuario_id = $${idx} AND deletado_em IS NULL`,
    valores as any[],
  );

  return buscarMeuPerfilCliente(usuarioId);
}

interface AtualizarClienteParams {
  nomeCompleto?: string;
  rg?: string;
  cnh?: string;
}

export async function atualizarCliente(
  clienteId: string,
  params: AtualizarClienteParams,
): Promise<Cliente | null> {
  if (params.nomeCompleto) Cliente.validarNome(params.nomeCompleto);

  const campos: string[] = [];
  const valores: unknown[] = [];
  let idx = 1;

  if (params.nomeCompleto !== undefined) { campos.push(`nome_completo = $${idx++}`); valores.push(params.nomeCompleto); }
  if (params.rg !== undefined) { campos.push(`rg = $${idx++}`); valores.push(params.rg); }
  if (params.cnh !== undefined) { campos.push(`cnh = $${idx++}`); valores.push(params.cnh); }

  if (campos.length === 0) return null;

  valores.push(clienteId);
  await query(
    `UPDATE cliente SET ${campos.join(', ')} WHERE id = $${idx} AND deletado_em IS NULL`,
    valores as any[],
  );

  return buscarClientePorId(clienteId);
}

export async function alterarSenha(usuarioId: string, novaSenha: string): Promise<void> {
  Usuario.validarSenha(novaSenha);
  const novoHash = await gerarHash(novaSenha);
  await query(
    `UPDATE usuario SET senha = $1 WHERE id = $2 AND deletado_em IS NULL`,
    [novoHash, usuarioId],
  );
}

export async function esqueciSenha(email: string): Promise<string | null> {
  const r = await query(`SELECT id FROM usuario WHERE email = $1 AND deletado_em IS NULL`, [email]);
  const user = r.rows[0];
  if (!user) return null;

  const resetToken = crypto.randomBytes(32).toString('hex');
  const expiraEm = new Date(Date.now() + 60 * 60 * 1000);

  await query(
    `UPDATE usuario SET reset_token = $1, reset_token_expira_em = $2 WHERE id = $3`,
    [resetToken, expiraEm, user.id]
  );
  return resetToken;
}

export async function redefinirSenhaComToken(token: string, novaSenha: string): Promise<void> {
  Usuario.validarSenha(novaSenha);

  const r = await query(
    `SELECT id, reset_token_expira_em FROM usuario WHERE reset_token = $1 AND deletado_em IS NULL`,
    [token]
  );
  const user = r.rows[0];

  if (!user) {
    throw new Error('Token inválido ou expirado.');
  }

  if (new Date() > new Date(user.reset_token_expira_em)) {
    throw new Error('O token de recuperação expirou. Solicite um novo.');
  }

  const novoHash = await gerarHash(novaSenha);
  await query(
    `UPDATE usuario SET senha = $1, reset_token = NULL, reset_token_expira_em = NULL WHERE id = $2`,
    [novoHash, user.id]
  );
}

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
