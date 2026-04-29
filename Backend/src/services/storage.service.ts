import { IncomingMessage } from 'http';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

// Verifica se o diretório existe, caso contrário cria
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export async function processarUpload(req: IncomingMessage): Promise<{ campos: Record<string, any>, caminhoImagem: string | null }> {
    const form = formidable({
        uploadDir: UPLOAD_DIR,
        keepExtensions: true,
        maxFileSize: 5 * 1024 * 1024, // 5MB
        filename: (name, ext, part) => {
            // Nome final seguro com UUID para evitar Path Traversal
            return `${uuidv4()}${ext}`;
        },
        filter: (part) => {
            // Validar tipo de arquivo
            return part.mimetype?.includes('image/') ?? false;
        }
    });

    return new Promise((resolve, reject) => {
        form.parse(req, (err, fields, files) => {
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
                    caminhoImagem = `/uploads/${file.newFilename}`;
                }
            }

            resolve({ campos, caminhoImagem });
        });
    });
}
