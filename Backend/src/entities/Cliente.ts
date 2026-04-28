const CPF_REGEX = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/;

export class Cliente {
  readonly id: string;
  readonly usuarioId: string;
  readonly nomeCompleto: string;
  readonly cpf: string;
  readonly rg: string | null;
  readonly cnh: string | null;
  readonly criadoEm: Date;
  readonly deletadoEm: Date | null;

  constructor(dados: {
    id: string;
    usuarioId: string;
    nomeCompleto: string;
    cpf: string;
    rg: string | null;
    cnh: string | null;
    criadoEm: Date;
    deletadoEm: Date | null;
  }) {
    this.id = dados.id;
    this.usuarioId = dados.usuarioId;
    this.nomeCompleto = dados.nomeCompleto;
    this.cpf = dados.cpf;
    this.rg = dados.rg;
    this.cnh = dados.cnh;
    this.criadoEm = dados.criadoEm;
    this.deletadoEm = dados.deletadoEm;
  }

  // ──────────────────────────────────────────────
  // Regras de negócio estáticas
  // ──────────────────────────────────────────────

  static validarNome(nome: string): void {
    if (!nome || nome.trim().length < 3) {
      throw new Error('Nome completo deve ter no mínimo 3 caracteres.');
    }
  }

  static validarCpf(cpf: string): void {
    if (!cpf || !CPF_REGEX.test(cpf)) {
      throw new Error('CPF deve estar no formato 000.000.000-00.');
    }
  }

  // ──────────────────────────────────────────────
  // Regras de negócio de instância
  // ──────────────────────────────────────────────

  podeDirigir(): boolean {
    return this.cnh !== null && this.cnh.trim().length > 0;
  }

  estaAtivo(): boolean {
    return this.deletadoEm === null;
  }
}
