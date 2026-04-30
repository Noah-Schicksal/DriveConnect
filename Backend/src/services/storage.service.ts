import { IncomingMessage } from 'http';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'carros');

// Verifica se o diretório existe, caso contrário cria
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export async function processarUpload(req: IncomingMessage): Promise<{ campos: Record<string, any>, caminhoImagem: string | null }> {
    const form = formidable({
        uploadDir: UPLOAD_DIR,
        keepExtensions: true,
        maxFileSize: 5 * 1024 * 1024, // 5MB
        filename: (name: string, ext: string, part: any) => {
            // Nome final seguro com UUID para evitar Path Traversal
            return `${uuidv4()}${ext}`;
        },
        filter: (part: any) => {
            // Validar tipo de arquivo
            return part.mimetype?.includes('image/') ?? false;
        }
    });

    return new Promise((resolve, reject) => {
        form.parse(req, (err: any, fields: any, files: any) => {
            if (err) {
                return reject(new Error('Erro ao processar arquivo: ' + err.message));
            }

            const campos: Record<string, any> = {};
            for (const key in fields) {
                const val = fields[key];
                campos[key] = Array.isArray(val) ? val[0] : val;
            }

            let caminhoImagem: string | null = null;
            if (files.imagem) {
                const fileArray = Array.isArray(files.imagem) ? files.imagem : [files.imagem];
                const file = fileArray[0];
                if (file) {
                    // Agora salvamos só o nome do arquivo para usar na rota segura /storage/carros/
                    caminhoImagem = file.newFilename;
                }
            }

            resolve({ campos, caminhoImagem });
        });
    });
}

// Ler arquivo de forma segura
export function lerArquivoSeguro(filename: string): fs.ReadStream {
    const filepath = path.join(UPLOAD_DIR, filename);
    
    // Evita path traversal: verifica se o caminho resolvido continua dentro da pasta
    if (!filepath.startsWith(UPLOAD_DIR)) {
        throw new Error('Acesso negado.');
    }
    
    if (!fs.existsSync(filepath)) {
        throw new Error('Arquivo não encontrado.');
    }

    return fs.createReadStream(filepath);
}
