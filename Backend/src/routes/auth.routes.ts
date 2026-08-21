import { IncomingMessage, ServerResponse } from 'http';
import * as argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query, getClient } from '../db/index.js';
import { checkRole } from '../utils/auth.js';
import { Cliente } from '../entities/Cliente.js';

const loginSchema = z.object({
  email: z.string().email('Formato de e-mail inválido.'),
  senha: z.string().min(1, 'Senha é obrigatória.'),
});

const registerSchema = z.object({
  email: z.string().email('Formato de e-mail inválido.'),
  senha: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres.'),
  nome_completo: z.string().min(3, 'Nome completo deve ter no mínimo 3 caracteres.'),
  cpf: z.string().min(11, 'CPF é obrigatório.'),
});

const registerManagerSchema = z.object({
  email: z.string().email('Formato de e-mail inválido.'),
  senha: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres.'),
  nome_completo: z.string().min(3, 'Nome completo deve ter no mínimo 3 caracteres.'),
  filial_id: z.string().uuid('ID de filial inválido.').nullable().optional(),
});

export async function login(req: IncomingMessage, res: ServerResponse) {
  try {
    const corpo = await lerCorpo(req);
    const validation = loginSchema.safeParse(corpo);
    if (!validation.success) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: validation.error.issues[0]?.message || 'Erro de validação.' }));
      return;
    }

    const { email, senha } = validation.data;
    const { rows } = await query('SELECT * FROM usuario WHERE email = $1 AND deletado_em IS NULL', [email]);
    const user = rows[0];

    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Credenciais inválidas.' }));
      return;
    }

    const isPasswordValid = await argon2.verify(user.senha, senha);
    if (!isPasswordValid) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Credenciais inválidas.' }));
      return;
    }

    let nome = '';
    if (user.tipo === 'CLIENTE') {
      const clienteRows = await query('SELECT nome_completo FROM cliente WHERE usuario_id = $1', [user.id]);
      if (clienteRows.rows.length > 0) {
        nome = clienteRows.rows[0].nome_completo;
      }
    } else if (user.tipo === 'GERENTE' || user.tipo === 'ADMIN') {
      const gerenteRows = await query('SELECT nome_completo FROM gerente WHERE usuario_id = $1', [user.id]);
      if (gerenteRows.rows.length > 0) {
        nome = gerenteRows.rows[0].nome_completo;
      }
    }

    const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key';
    const token = jwt.sign(
      { id: user.id, email: user.email, tipo: user.tipo },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      token,
      user: {
        id: user.id,
        email: user.email,
        nome,
        tipo: user.tipo,
        criado_em: user.criado_em
      }
    }));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: 'Erro interno no servidor.' }));
  }
}

export async function register(req: IncomingMessage, res: ServerResponse) {
  try {
    const corpo = await lerCorpo(req);
    const validation = registerSchema.safeParse(corpo);
    if (!validation.success) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: validation.error.issues[0]?.message || 'Erro de validação.' }));
      return;
    }

    const { email, senha, nome_completo, cpf } = validation.data;
    const client = await getClient();

    let cpfNormalizado: string;
    try {
      cpfNormalizado = Cliente.normalizarCpf(cpf);
    } catch {
      client.release();
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'CPF inválido.' }));
      return;
    }

    const userExists = await client.query('SELECT id FROM usuario WHERE email = $1', [email]);
    if (userExists.rows.length > 0) {
      client.release();
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'E-mail já está em uso.' }));
      return;
    }

    const cpfExists = await client.query('SELECT id FROM cliente WHERE cpf = $1', [cpfNormalizado]);
    if (cpfExists.rows.length > 0) {
      client.release();
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'CPF já está em uso.' }));
      return;
    }

    await client.query('BEGIN');
    const hashedPassword = await argon2.hash(senha);

    const userInsert = await client.query(
      'INSERT INTO usuario (email, senha, tipo) VALUES ($1, $2, $3) RETURNING id, email, tipo, criado_em',
      [email, hashedPassword, 'CLIENTE']
    );
    const newUser = userInsert.rows[0];

    await client.query(
      'INSERT INTO cliente (usuario_id, nome_completo, cpf) VALUES ($1, $2, $3)',
      [newUser.id, nome_completo, cpfNormalizado]
    );

    await client.query('COMMIT');
    client.release();

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      mensagem: 'Conta criada com sucesso.'
    }));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: 'Erro interno no servidor.' }));
  }
}

export async function registerManager(req: IncomingMessage, res: ServerResponse) {
  const currentUser = checkRole(req, res, ['ADMIN']);
  if (!currentUser) return;

  try {
    const corpo = await lerCorpo(req);
    const normalizedBody = {
      ...corpo,
      senha: corpo.senha || corpo.password
    };
    const validation = registerManagerSchema.safeParse(normalizedBody);
    if (!validation.success) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: validation.error.issues[0]?.message || 'Erro de validação.' }));
      return;
    }

    const { email, senha, nome_completo, filial_id } = validation.data;
    const client = await getClient();

    const userExists = await client.query('SELECT id FROM usuario WHERE email = $1', [email]);
    if (userExists.rows.length > 0) {
      client.release();
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'E-mail já está em uso.' }));
      return;
    }

    await client.query('BEGIN');
    const hashedPassword = await argon2.hash(senha);

    const userInsert = await client.query(
      'INSERT INTO usuario (email, senha, tipo) VALUES ($1, $2, $3) RETURNING id, email, tipo, criado_em',
      [email, hashedPassword, 'GERENTE']
    );
    const newUser = userInsert.rows[0];

    await client.query(
      'INSERT INTO gerente (usuario_id, nome_completo, filial_id) VALUES ($1, $2, $3)',
      [newUser.id, nome_completo, filial_id || null]
    );

    await client.query('COMMIT');
    client.release();

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      mensagem: 'Conta de gerente criada com sucesso.',
      gerente: { id: newUser.id, email: newUser.email, nome: nome_completo }
    }));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: 'Erro interno no servidor.' }));
  }
}

function lerCorpo(req: IncomingMessage): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.on('data', (chunk) => (dados += chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(dados || '{}')); }
      catch { reject(new Error('JSON inválido no corpo da requisição.')); }
    });
    req.on('error', reject);
  });
}
