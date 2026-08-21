import { query } from '../db/index.js';
import type { PoolClient } from 'pg';

export class UsuarioRepository {
  static async findByEmail(email: string) {
    const res = await query(
      `SELECT id, email, senha, tipo, imagem_url, preferencias FROM usuario WHERE email = $1 AND deletado_em IS NULL`,
      [email]
    );
    return res.rows[0] || null;
  }

  static async findPerfilCliente(usuarioId: string) {
    const res = await query(`SELECT id FROM cliente WHERE usuario_id = $1`, [usuarioId]);
    return res.rows[0]?.id || null;
  }

  static async findPerfilGerente(usuarioId: string) {
    const res = await query(`SELECT id, filial_id FROM gerente WHERE usuario_id = $1`, [usuarioId]);
    if (!res.rows[0]) return null;
    return {
      perfilId: res.rows[0].id,
      filialId: res.rows[0].filial_id
    };
  }

  static async findById(id: string) {
    const res = await query(
      `SELECT id, email, tipo, imagem_url, preferencias, criado_em, deletado_em FROM usuario WHERE id = $1`,
      [id]
    );
    return res.rows[0] || null;
  }

  static async insertUsuario(client: PoolClient, email: string, senhaHash: string, tipo: 'CLIENTE' | 'GERENTE') {
    const res = await client.query(
      `INSERT INTO usuario (email, senha, tipo) VALUES ($1, $2, $3) RETURNING id`,
      [email, senhaHash, tipo]
    );
    return res.rows[0].id as string;
  }

  static async insertCliente(
    client: PoolClient,
    usuarioId: string,
    nome: string,
    cpf: string,
    rg: string | null,
    cnh: string | null,
    telefone: string | null
  ) {
    const res = await client.query(
      `INSERT INTO cliente (usuario_id, nome_completo, cpf, rg, cnh, telefone) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [usuarioId, nome, cpf, rg, cnh, telefone]
    );
    return res.rows[0].id as string;
  }

  static async insertGerente(client: PoolClient, usuarioId: string, nome: string, filialId: string | null) {
    const res = await client.query(
      `INSERT INTO gerente (usuario_id, nome_completo, filial_id) VALUES ($1, $2, $3) RETURNING id`,
      [usuarioId, nome, filialId]
    );
    return res.rows[0].id as string;
  }

  static async updateImagemUrl(usuarioId: string, imagemUrl: string) {
    await query(
      `UPDATE usuario SET imagem_url = $1 WHERE id = $2 AND deletado_em IS NULL`,
      [imagemUrl, usuarioId]
    );
  }

  static async updatePreferencias(usuarioId: string, preferencias: any) {
    await query(
      `UPDATE usuario SET preferencias = $1 WHERE id = $2 AND deletado_em IS NULL`,
      [JSON.stringify(preferencias), usuarioId]
    );
  }
}
