/// <reference types="node" />
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// Mock dependencies
jest.unstable_mockModule('../../../src/db/index.js', () => ({
  query: jest.fn().mockResolvedValue({ rows: [{ status: 'OPEN' }] }),
  getClient: jest.fn().mockResolvedValue({
    query: jest.fn(),
    release: jest.fn(),
  }),
}));

jest.unstable_mockModule('../../../src/ai/rag.js', () => ({
  answerWhatsAppMessage: jest.fn().mockResolvedValue('Mocked AI response'),
}));

jest.unstable_mockModule('../../../src/ai/agent.js', () => ({
  atenderClienteComAgent: jest.fn().mockResolvedValue({
    resposta: 'Mocked AI response',
    intencao: 'GENERICO',
    tools_usadas: [],
  }),
}));

jest.unstable_mockModule('../../../src/services/whatsappStorage.service.js', () => ({
  ensureConversation: jest.fn().mockResolvedValue({ id: 'conv-123' }),
  storeMessage: jest.fn().mockResolvedValue({ id: 'msg-stored-123' }),
  updateMessageStatus: jest.fn().mockResolvedValue(undefined),
  getConversationHistory: jest.fn().mockResolvedValue([]),
  getWhatsappReserva: jest.fn().mockResolvedValue(null),
  linkReservaToConversation: jest.fn().mockResolvedValue(undefined),
  markWhatsappReservaNotified: jest.fn().mockResolvedValue(undefined),
  pauseConversation: jest.fn().mockResolvedValue(undefined),
  resumeConversation: jest.fn().mockResolvedValue(undefined),
  sendManagerMessage: jest.fn().mockResolvedValue(undefined),
}));

jest.unstable_mockModule('../../../src/services/reserva.service.js', () => ({
  buscarVeiculoDisponivelPorFilial: jest.fn(),
  calcularValorTotal: jest.fn(),
  criarReservaPendente: jest.fn(),
  buscarVeiculoFisicoDisponivelSemData: jest.fn(),
}));

const { sendMessage, processIncomingMessage } = await import('../../../src/services/whatsapp.service.js');
const { ensureConversation, storeMessage } = await import('../../../src/services/whatsappStorage.service.js');

describe('WhatsApp Service Unit Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      WHATSAPP_ACCESS_TOKEN: 'test-token',
      WHATSAPP_PHONE_NUMBER_ID: '123456789',
      WHATSAPP_GRAPH_API_VERSION: 'v19.0',
      WHATSAPP_LOG_MESSAGE_BODY: '0',
      DEDUPE_TTL_MS: '60000',
    };
    mockFetch.mockClear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const mockTextPayload = {
    ok: true,
    status: 200,
    json: async () => ({ messages: [{ id: '123' }] }),
  };

  describe('sendMessage', () => {
    it('should send a text message successfully', async () => {
      mockFetch.mockResolvedValueOnce(mockTextPayload);

      await sendMessage('5511999999999', 'Hello World');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0] as [string, any];

      expect(url).toBe('https://graph.facebook.com/v19.0/123456789/messages');
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(options.body);
      expect(body).toEqual({
        messaging_product: 'whatsapp',
        to: '5511999999999',
        type: 'text',
        text: { body: 'Hello World' },
      });
    });

    it('should throw an error if missing required env vars', async () => {
      delete process.env.WHATSAPP_ACCESS_TOKEN;
      delete process.env.ACCESS_TOKEN;

      await expect(sendMessage('5511999999999', 'Hello')).rejects.toThrow('Missing required env var: WHATSAPP_ACCESS_TOKEN');
    });

    it('should throw an error if Graph API returns non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request Error',
      });

      await expect(sendMessage('5511999999999', 'Hello')).rejects.toThrow('Graph API error: HTTP 400 Bad Request Error');
    });
  });

  describe('processIncomingMessage', () => {
    const createMockPayload = (id: string, from: string, body: string) => ({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id,
              from,
              type: 'text',
              text: { body }
            }]
          }
        }]
      }]
    });

    it('should process a valid incoming message and send a reply', async () => {
      // Mock successful reply send
      mockFetch.mockResolvedValueOnce(mockTextPayload);

      const payload = createMockPayload('msg-1', '5511999999999', 'Oi BOT');

      await processIncomingMessage(payload);

      expect(ensureConversation).toHaveBeenCalledWith('5511999999999');
      expect(storeMessage).toHaveBeenCalled();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, options] = mockFetch.mock.calls[0] as [string, any];
      const sentBody = JSON.parse(options.body);

      expect(sentBody.to).toBe('5511999999999');
      expect(sentBody.text.body).toBe('Mocked AI response');
    });

    it('should deduplicate messages with the same ID', async () => {
      mockFetch.mockResolvedValue(mockTextPayload);

      const payload = createMockPayload('msg-dedupe-1', '5511999999999', 'Duplicate msg');

      // First call should process and fetch
      await processIncomingMessage(payload);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call with same payload (same message ID) should be deduplicated
      await processIncomingMessage(payload);

      // Fetch should still be called only once
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should ignore empty payloads or payload without messages', async () => {
      await processIncomingMessage({});
      await processIncomingMessage({ entry: [] });
      await processIncomingMessage({ entry: [{ changes: [] }] });

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
