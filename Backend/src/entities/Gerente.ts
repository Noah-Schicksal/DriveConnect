export class Gerente {
  readonly id: string;
  readonly usuarioId: string;
  readonly nomeCompleto: string;
  readonly filialId: string | null;
  readonly criadoEm: Date;
  readonly deletadoEm: Date | null;

  constructor(dados: {
    id: string;
    usuarioId: string;
    nomeCompleto: string;
    filialId: string | null;
    criadoEm: Date;
    deletadoEm: Date | null;
  }) {
    this.id = dados.id;
    this.usuarioId = dados.usuarioId;
    this.nomeCompleto = dados.nomeCompleto;
    this.filialId = dados.filialId;
    this.criadoEm = dados.criadoEm;
    this.deletadoEm = dados.deletadoEm;
  }

  // ──────────────────────────────────────────────
  // Regras de negócio de instância
  // ──────────────────────────────────────────────

  /** Gerente sem filial_id tem acesso a todas as filiais (gerente global). */
  isGlobal(): boolean {
    return this.filialId === null;
  }

  podeGerenciarFilial(filialId: string): boolean {
    return this.isGlobal() || this.filialId === filialId;
  }

  estaAtivo(): boolean {
    return this.deletadoEm === null;
  }
}
