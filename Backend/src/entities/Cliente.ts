const CPF_FORMATTED_REGEX = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/;

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

  // Regras de negócio estáticas
  static validarNome(nome: string): void {
    if (!nome || nome.trim().length < 3) {
      throw new Error('Nome completo deve ter no mínimo 3 caracteres.');
    }
  }

  static validarCpf(cpf: string): void {
    const digits = (cpf ?? '').replace(/\D/g, '');
    if (digits.length !== 11 || !/^\d{11}$/.test(digits)) throw new Error('CPF inválido.');
  }

  /**
   * Normaliza CPF para o formato `000.000.000-00`.
   * Aceita entrada com ou sem pontuação.
   */
  static normalizarCpf(cpf: string): string {
    const digits = (cpf ?? '').replace(/\D/g, '');
    if (digits.length !== 11 || !/^\d{11}$/.test(digits)) throw new Error('CPF inválido.');
    const formatted = `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
    // Garantia extra (evita regressão caso o formato mude)
    if (!CPF_FORMATTED_REGEX.test(formatted)) throw new Error('CPF inválido.');
    return formatted;
  }

  // Regras de negócio de instância
  podeDirigir(): boolean {
    return this.cnh !== null && this.cnh.trim().length > 0;
  }

  estaAtivo(): boolean {
    return this.deletadoEm === null;
  }
}
