import type { IncomingMessage } from 'http';
import type { TipoUsuario } from '../entities/Usuario.js';
import jwt from 'jsonwebtoken';

// Tipos
export interface Caller {
  usuarioId: string;
  tipo: TipoUsuario;
  /** Para gerentes: filial_id vinculada. null = gerente global (acesso total). */
  filialId: string | null;
}

// Estende IncomingMessage para carregar o caller injetado pelos guards
export interface AuthenticatedRequest extends IncomingMessage {
  caller?: Caller;
}

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key';

export interface JwtPayload {
  id: string;
  email: string;
  tipo: TipoUsuario;
  filialId?: string | null;
  iat?: number;
  exp?: number;
}

// Geração de JWT
export function gerarToken(payload: { id: string; email: string; tipo: TipoUsuario; filialId?: string | null }): string {
  return jwt.sign(
    { id: payload.id, email: payload.email, tipo: payload.tipo, filialId: payload.filialId ?? null },
    JWT_SECRET,
    { expiresIn: '24h' },
  );
}

// Extração de identidade via JWT (Authorization: Bearer <token>)
// Fallback para headers x-usuario-id/x-tipo (compatibilidade)
export function extractCaller(req: IncomingMessage): Caller | null {
  // 1. Tenta extrair do JWT (Authorization header)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
        const tiposValidos: TipoUsuario[] = ['CLIENTE', 'GERENTE', 'ADMIN'];
        if (!tiposValidos.includes(decoded.tipo)) return null;

        return {
          usuarioId: decoded.id,
          tipo: decoded.tipo,
          filialId: decoded.filialId ?? null,
        };
      } catch {
        return null; // Token inválido ou expirado
      }
    }
  }

  // 2. Fallback: headers legados (x-usuario-id, x-tipo)
  const usuarioId = req.headers['x-usuario-id'];
  const tipo      = req.headers['x-tipo'];
  const filialId  = req.headers['x-filial-id'];

  if (
    typeof usuarioId !== 'string' || usuarioId.trim() === '' ||
    typeof tipo !== 'string'      || tipo.trim() === ''
  ) {
    return null;
  }

  const tiposValidos: TipoUsuario[] = ['CLIENTE', 'GERENTE', 'ADMIN'];
  if (!tiposValidos.includes(tipo as TipoUsuario)) return null;

  return {
    usuarioId: usuarioId.trim(),
    tipo: tipo as TipoUsuario,
    filialId: typeof filialId === 'string' && filialId.trim() !== '' ? filialId.trim() : null,
  };
}

// Guards reutilizáveis
/** Garante que o caller está autenticado. Lança Error se não. */
export function requireCaller(req: IncomingMessage): Caller {
  const caller = extractCaller(req);
  if (!caller) throw new Error('Não autorizado: identidade ausente ou inválida.');
  return caller;
}

/** Garante que o caller tem um dos tipos informados. */
export function requireTipo(caller: Caller, ...tipos: TipoUsuario[]): void {
  if (!tipos.includes(caller.tipo)) {
    throw new Error('Sem permissão para acessar este recurso.');
  }
}

/**
 * Garante que o caller é dono do recurso (usuarioId bate) OU tem um tipo privilegiado.
 * Clientes só passam se o `donoDosId` for igual ao próprio ID de usuário.
 */
export function requireOwnership(caller: Caller, donoId: string, ...tiposPrivilegiados: TipoUsuario[]): void {
  if (tiposPrivilegiados.includes(caller.tipo)) return;
  if (caller.usuarioId === donoId) return;
  throw new Error('Sem permissão: você só pode acessar seus próprios dados.');
}
