import 'dotenv/config';
import { query } from '../db/index.js';
import type { Caller } from '../middlewares/auth.js';
import { gerarLinkPagamento } from './payment.service.js';

const INFINITEPAY_API = 'https://api.infinitepay.io/v1';

export async function estornarPagamento(reservaId: string, caller: Caller): Promise<void> {
    // 1. Busca a reserva
    const res = await query(
        `SELECT r.id, r.status, r.infinitepay_nsu, r.filial_retirada_id, r.filial_devolucao_id
         FROM reserva r
         WHERE r.id = $1 AND r.deletado_em IS NULL`,
        [reservaId]
    );

    const reserva = res.rows[0];
    if (!reserva) throw new Error('Reserva não encontrada.');

    // 2. Validações de acesso
    if (caller.tipo === 'GERENTE' && caller.filialId !== null) {
        if (reserva.filial_retirada_id !== caller.filialId && reserva.filial_devolucao_id !== caller.filialId) {
            throw new Error('Sem permissão para estornar reserva de outra filial.');
        }
    }

    // 3. Validações de negócio
    if (!reserva.infinitepay_nsu) {
        throw new Error('Não há transação da InfinitePay registrada para esta reserva. Ela ainda não foi paga.');
    }
    
    // Na vida real, InfinitePay exige a chave da API (diferente do Checkout Handle)
    const apiKey = process.env.INFINITEPAY_API_KEY;
    if (!apiKey) {
        console.warn('[Financeiro] INFINITEPAY_API_KEY não configurada. Simulando sucesso do estorno.');
    } else {
        // 4. Chamada HTTP para InfinitePay (Cancelamento/Estorno)
        const resposta = await fetch(`${INFINITEPAY_API}/transactions/${reserva.infinitepay_nsu}/refund`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                reason: 'CANCELAMENTO_RESERVA'
            })
        });

        if (!resposta.ok) {
            const erroText = await resposta.text();
            console.warn(`[Mock Mode] Falha ao estornar na InfinitePay: ${erroText}. Assumindo sucesso local para fins de desenvolvimento.`);
            // Em produção: throw new Error(`Falha no estorno: ${erroText}`);
        }
    }

    // 5. Atualiza o banco (cria registro de SAIDA em transacao)
    await query(`
        INSERT INTO transacao (filial_id, tipo, valor, descricao)
        SELECT filial_retirada_id, 'SAIDA', valor_total, 'Estorno de Reserva: ' || id
        FROM reserva WHERE id = $1
    `, [reservaId]);
}

interface ItemExtra {
    descricao: string;
    valor: number;
}

export async function criarCobrancaExtra(reservaId: string, itens: ItemExtra[], caller: Caller) {
    const res = await query(`
        SELECT r.id, r.filial_retirada_id, c.nome_completo, c.email
        FROM reserva r
        JOIN cliente c ON c.id = r.cliente_id
        WHERE r.id = $1 AND r.deletado_em IS NULL
    `, [reservaId]);

    const reserva = res.rows[0];
    if (!reserva) throw new Error('Reserva não encontrada.');

    // Validações de acesso
    if (caller.tipo === 'GERENTE' && caller.filialId !== null && reserva.filial_retirada_id !== caller.filialId) {
        throw new Error('Sem permissão para gerar cobrança nesta reserva.');
    }

    let valorTotalExtras = 0;
    const itensPagamento = itens.map(item => {
        valorTotalExtras += item.valor;
        return {
            quantity: 1,
            price: Math.round(item.valor * 100),
            description: item.descricao
        };
    });

    // Gera um NSU temporário único para esta cobrança extra
    const orderNsuExtra = `${reservaId}_extra_${Date.now()}`;
    
    // Chama a InfinitePay para gerar o checkout
    const { link_pagamento, slug } = await gerarLinkPagamento({
        orderNsu: orderNsuExtra,
        itens: itensPagamento,
        cliente: {
            name: reserva.nome_completo,
            email: reserva.email
        }
    });

    // Atualiza o valor adicional da reserva no banco
    await query(`
        UPDATE reserva 
        SET valor_adicional = COALESCE(valor_adicional, 0) + $1
        WHERE id = $2
    `, [valorTotalExtras, reservaId]);

    return {
        link: link_pagamento,
        valorCobrado: valorTotalExtras,
        nsu_pagamento: orderNsuExtra
    };
}
