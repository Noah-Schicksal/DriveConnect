import { jest, describe, it, expect, afterEach, beforeEach } from '@jest/globals';
import { IncomingMessage } from 'http';
import path from 'path';

// Mocks
jest.unstable_mockModule('fs', () => ({
  default: {
    existsSync: jest.fn().mockReturnValue(true), // Previne criar pasta toda vez que importa
    mkdirSync: jest.fn(),
    createReadStream: jest.fn(),
  }
}));

const mockParse = jest.fn();
jest.unstable_mockModule('formidable', () => ({
  default: jest.fn(() => ({
    parse: mockParse
  }))
}));

const fs = (await import('fs')).default;
const formidable = (await import('formidable')).default;
const { processarUpload, lerArquivoSeguro } = await import('../../../src/services/storage.service.js');

describe('Storage Service', () => {
  const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'carros');

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processarUpload', () => {
    let mockReq: IncomingMessage;

    beforeEach(() => {
      mockReq = {} as IncomingMessage;
    });

    it('deve rejeitar com erro se o parse do form falhar', async () => {
      mockParse.mockImplementationOnce((req: any, cb: Function) => {
        cb(new Error('Erro interno do formidable'), null, null);
      });

      await expect(processarUpload(mockReq)).rejects.toThrow('Erro ao processar arquivo: Erro interno do formidable');
    });

    it('deve processar campos e retornar caminho da imagem em caso de sucesso', async () => {
      mockParse.mockImplementationOnce((req: any, cb: Function) => {
        cb(null, { nome: ['Fusca'], portas: ['2'] }, { imagem: [{ newFilename: 'uuid-123.jpg' }] });
      });

      const resultado = await processarUpload(mockReq);

      expect(resultado).toEqual({
        campos: { nome: 'Fusca', portas: '2' },
        caminhoImagem: 'uuid-123.jpg'
      });
    });

    it('deve processar sem imagem caso não seja enviada', async () => {
      mockParse.mockImplementationOnce((req: any, cb: Function) => {
        cb(null, { modelo: ['Civic'] }, {});
      });

      const resultado = await processarUpload(mockReq);

      expect(resultado).toEqual({
        campos: { modelo: 'Civic' },
        caminhoImagem: null
      });
    });

    it('deve configurar corretamente o formidable', async () => {
      mockParse.mockImplementationOnce((req: any, cb: Function) => {
        cb(null, {}, {});
      });

      await processarUpload(mockReq);

      const formCallArgs = (formidable as unknown as jest.Mock).mock.calls[0][0] as any;
      
      expect(formCallArgs.uploadDir).toBe(UPLOAD_DIR);
      expect(formCallArgs.keepExtensions).toBe(true);
      expect(formCallArgs.maxFileSize).toBe(5 * 1024 * 1024);
      
      // Valida o filename (deve gerar um hash + extensão)
      const novoNome = formCallArgs.filename('nome-original', '.jpg', {});
      expect(novoNome).toMatch(/.+\.jpg$/);

      // Valida o filter (aceita só image/)
      expect(formCallArgs.filter({ mimetype: 'image/png' })).toBe(true);
      expect(formCallArgs.filter({ mimetype: 'application/pdf' })).toBe(false);
      expect(formCallArgs.filter({ mimetype: undefined })).toBe(false);
    });
  });

  describe('lerArquivoSeguro', () => {
    it('deve lançar erro de acesso negado em caso de path traversal', () => {
      expect(() => lerArquivoSeguro('../../../../etc/passwd')).toThrow('Acesso negado.');
    });

    it('deve lançar erro se arquivo não existir', () => {
      (fs.existsSync as jest.Mock<any>).mockReturnValueOnce(false);
      
      expect(() => lerArquivoSeguro('imagem-inexistente.jpg')).toThrow('Arquivo não encontrado.');
      expect(fs.existsSync).toHaveBeenCalledWith(path.join(UPLOAD_DIR, 'imagem-inexistente.jpg'));
    });

    it('deve retornar o stream de leitura do arquivo em caso de sucesso', () => {
      (fs.existsSync as jest.Mock<any>).mockReturnValueOnce(true);
      const mockStream = { on: jest.fn() };
      (fs.createReadStream as jest.Mock<any>).mockReturnValueOnce(mockStream);

      const stream = lerArquivoSeguro('carro.jpg');

      expect(fs.createReadStream).toHaveBeenCalledWith(path.join(UPLOAD_DIR, 'carro.jpg'));
      expect(stream).toBe(mockStream);
    });
  });
});
