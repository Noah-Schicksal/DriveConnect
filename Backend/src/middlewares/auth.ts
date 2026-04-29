import type { IncomingMessage } from 'http';
import type { TipoUsuario } from '../entities/Usuario.js';

// ──────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────

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

// ──────────────────────────────────────────────
// Extração de identidade via headers
// Produção: troque isso por verificação de JWT
// ──────────────────────────────────────────────

export function extractCaller(req: IncomingMessage): Caller | null {
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

// ──────────────────────────────────────────────
// Guards reutilizáveis
// ──────────────────────────────────────────────

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
