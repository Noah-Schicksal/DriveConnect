// Tipos válidos de usuário no sistema
export type TipoUsuario = 'CLIENTE' | 'GERENTE' | 'ADMIN';

const TIPOS_VALIDOS: TipoUsuario[] = ['CLIENTE', 'GERENTE', 'ADMIN'];
const SENHA_MIN_LENGTH = 8;

export class Usuario {
  readonly id: string;
  readonly email: string;
  readonly tipo: TipoUsuario;
  readonly criadoEm: Date;
  readonly deletadoEm: Date | null;

  constructor(dados: {
    id: string;
    email: string;
    tipo: TipoUsuario;
    criadoEm: Date;
    deletadoEm: Date | null;
  }) {
    this.id = dados.id;
    this.email = dados.email;
    this.tipo = dados.tipo;
    this.criadoEm = dados.criadoEm;
    this.deletadoEm = dados.deletadoEm;
  }

  // ──────────────────────────────────────────────
  // Regras de negócio estáticas (validações de entrada)
  // ──────────────────────────────────────────────

  static validarEmail(email: string): void {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      throw new Error('E-mail inválido.');
    }
  }

  static validarSenha(senha: string): void {
    if (!senha || senha.length < SENHA_MIN_LENGTH) {
      throw new Error(`A senha deve ter no mínimo ${SENHA_MIN_LENGTH} caracteres.`);
    }
  }

  static validarTipo(tipo: string): asserts tipo is TipoUsuario {
    if (!TIPOS_VALIDOS.includes(tipo as TipoUsuario)) {
      throw new Error(`Tipo de usuário inválido. Valores aceitos: ${TIPOS_VALIDOS.join(', ')}.`);
    }
  }

  // ──────────────────────────────────────────────
  // Regras de negócio de instância
  // ──────────────────────────────────────────────

  estaAtivo(): boolean {
    return this.deletadoEm === null;
  }

  podeGerenciar(): boolean {
    return this.tipo === 'GERENTE' || this.tipo === 'ADMIN';
  }

  eAdmin(): boolean {
    return this.tipo === 'ADMIN';
  }
}
