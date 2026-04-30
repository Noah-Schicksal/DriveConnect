import { query } from '../db/index.js';
import type { Caller } from '../middlewares/auth.js';

// Utilitário para lidar com filtro de filial que respeita o perfil do GERENTE vs ADMIN
function buildFilialFilter(caller: Caller, filialParam?: string): { clause: string, param: string | null } {
    let filialId = filialParam || null;
    
    // Gerente de filial fixa NÃO PODE ver dados de outra filial
    if (caller.tipo === 'GERENTE' && caller.filialId !== null) {
        filialId = caller.filialId;
    }
    
    if (filialId) {
        return { clause: '= $1', param: filialId };
    }
    return { clause: 'IS NOT NULL', param: null };
}

async function validarDataInicio(dataInicio: string, filialId: string | null): Promise<void> {
    let querySql = 'SELECT MIN(criado_em) as min_data FROM filial';
    const params: any[] = [];
    
    if (filialId) {
        querySql = 'SELECT criado_em as min_data FROM filial WHERE id = $1';
        params.push(filialId);
    }
    
    const res = await query(querySql, params);
    if (!res.rows[0] || !res.rows[0].min_data) return;

    const criadoEm = new Date(res.rows[0].min_data);
    // Zera horas para comparar apenas datas
    criadoEm.setHours(0, 0, 0, 0);
    const dataIn = new Date(dataInicio);
    dataIn.setHours(0, 0, 0, 0);

    if (dataIn < criadoEm) {
        throw new Error(`A data inicial informada não pode ser anterior à data de inauguração da filial (${criadoEm.toISOString().split('T')[0]}).`);
    }
}

export async function obterFaturamento(caller: Caller, dataInicio: string, dataFim: string, filialParam?: string) {
    const { param } = buildFilialFilter(caller, filialParam);
    await validarDataInicio(dataInicio, param);
    const valores: any[] = [dataInicio, dataFim];
    let whereFilial = '';
    
    if (param) {
        valores.push(param);
        // O faturamento entra pra qual filial? Da retirada, pois o serviço começou lá.
        whereFilial = `AND r.filial_retirada_id = $3`;
    }

    const sql = `
        SELECT 
            COALESCE(SUM(r.valor_total), 0) AS total_base,
            COALESCE(SUM(r.valor_adicional), 0) AS total_extra,
            COALESCE(SUM(r.valor_total + COALESCE(r.valor_adicional, 0)), 0) AS faturamento_total,
            COUNT(r.id) AS qtd_reservas
        FROM reserva r
        WHERE r.pagamento_em IS NOT NULL
          AND r.deletado_em IS NULL
          AND r.criado_em >= $1 AND r.criado_em <= $2
          ${whereFilial}
    `;

    const res = await query(sql, valores);
    return {
        faturamentoTotal: Number(res.rows[0].faturamento_total),
        totalBase: Number(res.rows[0].total_base),
        totalExtra: Number(res.rows[0].total_extra),
        qtdReservas: Number(res.rows[0].qtd_reservas)
    };
}

export async function obterOcupacao(caller: Caller, dataInicio: string, dataFim: string, filialParam?: string) {
    const { param } = buildFilialFilter(caller, filialParam);
    await validarDataInicio(dataInicio, param);

    let whereFilialTotal = '';
    let paramTotal: any[] = [];
    if (param) {
        whereFilialTotal = `AND filial_id = $1`;
        paramTotal.push(param);
    }

    const sqlTotal = `
        SELECT 
            COUNT(id) AS total,
            SUM(CASE WHEN status = 'MANUTENCAO' THEN 1 ELSE 0 END) AS manutencao
        FROM veiculo
        WHERE deletado_em IS NULL ${whereFilialTotal}
    `;
    const resTotal = await query(sqlTotal, paramTotal);
    const total = Number(resTotal.rows[0].total || 0);
    const manutencao = Number(resTotal.rows[0].manutencao || 0);

    let whereFilialAlugados = '';
    let paramAlugados: any[] = [dataInicio, dataFim];
    if (param) {
        whereFilialAlugados = `AND v.filial_id = $3`;
        paramAlugados.push(param);
    }

    const sqlAlugados = `
        SELECT COUNT(DISTINCT r.veiculo_id) AS alugados
        FROM reserva r
        JOIN veiculo v ON v.id = r.veiculo_id
        WHERE r.status IN ('ATIVA', 'FINALIZADA', 'RESERVADA')
          AND r.data_inicio <= $2
          AND r.data_fim >= $1
          AND r.deletado_em IS NULL
          ${whereFilialAlugados}
    `;
    const resAlugados = await query(sqlAlugados, paramAlugados);
    const alugado = Number(resAlugados.rows[0].alugados || 0);
    const disponivel = total - alugado - manutencao;

    const ocupacao = {
        total,
        DISPONIVEL: disponivel < 0 ? 0 : disponivel,
        ALUGADO: alugado,
        MANUTENCAO: manutencao
    };

    const taxa = ocupacao.total > 0 ? (ocupacao.ALUGADO / ocupacao.total) * 100 : 0;

    return {
        ...ocupacao,
        taxaOcupacao: parseFloat(taxa.toFixed(2))
    };
}

export async function obterOperacao(caller: Caller, dataInicio: string, dataFim: string, filialParam?: string) {
    const { param } = buildFilialFilter(caller, filialParam);
    await validarDataInicio(dataInicio, param);

    const valores: any[] = [dataInicio, dataFim];
    let whereFilialRetirada = '';
    let whereFilialDevolucao = '';
    
    if (param) {
        valores.push(param);
        whereFilialRetirada = `AND r.filial_retirada_id = $3`;
        whereFilialDevolucao = `AND r.filial_devolucao_id = $3`;
    }

    // 1. Retiradas programadas no período
    const retiradasRes = await query(`
        SELECT COUNT(r.id) AS qtd 
        FROM reserva r 
        WHERE r.deletado_em IS NULL 
          AND r.data_inicio >= $1 AND r.data_inicio <= $2
          AND r.status IN ('PENDENTE_PAGAMENTO', 'RESERVADA', 'ATIVA', 'FINALIZADA')
          ${whereFilialRetirada}
    `, valores);

    // 2. Devoluções programadas no período
    const devolucoesRes = await query(`
        SELECT COUNT(r.id) AS qtd 
        FROM reserva r 
        WHERE r.deletado_em IS NULL 
          AND r.data_fim >= $1 AND r.data_fim <= $2
          AND r.status IN ('ATIVA', 'FINALIZADA')
          ${whereFilialDevolucao}
    `, valores);

    // 3. Atrasados (Data fim já passou de $2 e continua ATIVA)
    const atrasadosRes = await query(`
        SELECT COUNT(r.id) AS qtd 
        FROM reserva r 
        WHERE r.deletado_em IS NULL 
          AND r.data_fim < $2
          AND r.status = 'ATIVA'
          ${whereFilialDevolucao}
    `, valores);

    return {
        retiradas: Number(retiradasRes.rows[0].qtd),
        devolucoes: Number(devolucoesRes.rows[0].qtd),
        emAtraso: Number(atrasadosRes.rows[0].qtd)
    };
}
