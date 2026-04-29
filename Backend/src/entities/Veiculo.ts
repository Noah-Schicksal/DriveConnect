export interface Veiculo {
    id?: string;
    modelo_id: number;
    filial_id: string;
    placa: string;
    ano: number;
    cor?: string;
    status: 'DISPONIVEL' | 'ALUGADO' | 'MANUTENCAO';
    imagem_url?: string | null;
    criado_em?: Date;
    deletado_em?: Date | null;
}
