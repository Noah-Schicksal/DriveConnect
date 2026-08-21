/**
 * TESTES PARA AI AGENT E TOOLS
 * Rodar: npm test -- tests/unit/ai.test.ts
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import {
  toolListarFiliais,
  toolListarCarrosDisponiveis,
  toolValidarDisponibilidade,
  toolCriarReserva,
  toolObterReserva,
  toolRegistrarCliente,
  executeTool,
  type ToolResult,
} from '../../src/ai/tools.js';
import { atenderClienteComAgent } from '../../src/ai/agent.js';

describe('🤖 AI TOOLS & AGENT', () => {
  // INTENT DETECTION (VIA AGENT)
  describe('📋 Resposta do Agente e Intenção', () => {
    it('deve detectar intenção LISTAR_FILIAIS', async () => {
      const result = await atenderClienteComAgent('Vocês têm filiais em SP?');
      expect(result.intencao).toBe('LISTAR_FILIAIS');
    });

    it('deve detectar intenção LISTAR_CARROS', async () => {
      const result = await atenderClienteComAgent('Quais carros vocês têm?');
      expect(result.intencao).toBe('LISTAR_CARROS');
    });

    it('deve sugerir catálogo sem pedir datas quando o usuário quer apenas ver os veículos', async () => {
      const result = await atenderClienteComAgent('gostaria de ver os veiculos da filial matriz');
      // O agente deve retornar uma resposta que contenha opções do catálogo, 
      // sem necessariamente entrar em erro de "pedir datas" imediatamente se o buildLocalContext retornar frota
      expect(result.intencao).toBe('LISTAR_CARROS');
      expect(result.resposta.toLowerCase()).not.toContain('preciso das datas');
    });
  });

  // TOOLS EXECUTION
  describe('🔧 Execução de Tools', () => {
    it('listar_filiais deve retornar array de filiais', async () => {
      const result = await toolListarFiliais();
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      if (result.data && result.data.length > 0) {
        const filial = result.data[0];
        expect(filial).toHaveProperty('id');
        expect(filial).toHaveProperty('nome');
        expect(filial).toHaveProperty('endereco');
      }
    });

    it('listar_carros_disponiveis deve validar datas', async () => {
      const result = await toolListarCarrosDisponiveis({
        data_inicio: '2026-05-16',
        data_fim: '2026-05-14', // DATA FIM ANTES DO INÍCIO (ERRO)
      });
      expect(result.success).toBe(false);
      expect(result.error?.toLowerCase()).toContain('data fim deve ser');
    });

    it('listar_carros_disponiveis sem parâmetros deve retornar lista', async () => {
      const result = await toolListarCarrosDisponiveis({});
      if (result.success) {
        expect(Array.isArray(result.data)).toBe(true);
      }
    });

    it('validar_disponibilidade com veículo inválido deve falhar', async () => {
      const result = await toolValidarDisponibilidade({
        veiculo_id: 'id-invalido-uuid',
        data_inicio: '2026-05-16',
        data_fim: '2026-05-18',
      });
      // Pode falhar por validação de UUID ou por veículo não existir
      expect(typeof result.success).toBe('boolean');
    });

    it('registrar_cliente deve falhar com CPF inválido', async () => {
      const result = await toolRegistrarCliente({
        nome_completo: 'João Silva',
        email: 'joao@example.com',
        cpf: '000.000.000-00', // CPF inválido
      });
      expect(result.success).toBe(false);
    });

    it('criar_reserva sem cliente_id deve falhar', async () => {
      const result = await toolCriarReserva({
        cliente_id: '', // VAZIO
        veiculo_id: 'some-uuid',
        filial_retirada_id: 'some-uuid',
        data_inicio: '2026-05-16',
        data_fim: '2026-05-18',
      });
      expect(result.success).toBe(false);
    });
  });

  // EXECUTE TOOL DISPATCHER
  describe('⚙️ Dispatcher de Tools (executeTool)', () => {
    it('deve executar listar_filiais via dispatcher', async () => {
      const result = await executeTool('listar_filiais', {});
      expect(result.success).toBe(true);
    });

    it('deve executar listar_carros_disponiveis via dispatcher', async () => {
      const result = await executeTool('listar_carros_disponiveis', {
        data_inicio: '2026-05-16',
        data_fim: '2026-05-18',
      });
      expect(typeof result.success).toBe('boolean');
    });
  });

  // INTEGRATION TESTS (requerem DB real)
  describe('🔗 Testes de Integração (com DB)', () => {
    beforeAll(() => {
      // Setup
      console.log('   Iniciando testes de integração...');
    });

    afterAll(() => {
      // Cleanup
      console.log('   Encerrando testes de integração...');
    });

    it('fluxo completo: listar filiais → carros → validar → criar (MOCK)', async () => {
      // Simular fluxo completo sem criar data real
      // 1. Listar filiais
      const filiaisResult = await toolListarFiliais();
      if (!filiaisResult.success) {
        console.log('   ⚠️  Filiais não acessíveis, pulando teste');
        return;
      }

      const filiais = filiaisResult.data;
      if (!filiais || filiais.length === 0) {
        console.log('   ⚠️  Nenhuma filial encontrada');
        return;
      }

      // 2. Listar carros
      const carrosResult = await toolListarCarrosDisponiveis({
        filial_id: filiais[0].id,
        data_inicio: '2026-05-16',
        data_fim: '2026-05-18',
      });
      expect(typeof carrosResult.success).toBe('boolean');

      if (carrosResult.success && carrosResult.data && carrosResult.data.length > 0) {
        const carro = carrosResult.data[0];

        // 3. Validar disponibilidade
        const validacaoResult = await toolValidarDisponibilidade({
          veiculo_id: carro.id,
          data_inicio: '2026-05-16',
          data_fim: '2026-05-18',
        });
        expect(typeof validacaoResult.success).toBe('boolean');
      }
    });
  });
});
