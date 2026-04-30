# Context: Secure Storage

> Last updated: 2026-04-29T22:58:00Z
> Version: 1

## Purpose
Armazenamento local seguro e escalável para imagens de veículos do sistema DriveConnect, garantindo que arquivos estáticos não fiquem expostos na pasta pública sem autorização.

## Architecture / How It Works
- **Storage backend chosen:** Local Disk (servido via proxy do próprio Node.js).
- **Access pattern:** Leitura protegida por API KEY pública (`PUBLIC_API_KEY`) para prevenir *hotlinking*. Escrita restrita a administradores e gerentes via RBAC interno.
- **Upload flow:** Backend intercepta `multipart/form-data`, salva via UUID (para prevenir path traversal) no diretório local `/uploads/carros`, e persiste o nome do arquivo na tabela relacional `veiculo_imagem`.
- **Key dependencies:** `formidable` (upload parsing), `uuid` (file naming).

## Affected Project Files
| File | Uses this system? | Relationship |
|------|:-----------------:|--------------|
| `Backend/src/services/storage.service.ts` | Yes | Serviço central: trata streaming, validação de mimetype e path traversal. |
| `Backend/src/server.ts` | Yes | Expõe a rota protegida `GET /storage/carros/:filename`. |
| `Backend/src/routes/veiculo.routes.ts` | Yes | Expõe a rota de upload `POST /veiculos/:id/imagens`. |
| `Backend/src/services/veiculo.service.ts` | Yes | Persiste o relacionamento `veiculo_imagem` no PostgreSQL. |

## Code Reference
### `Backend/src/services/storage.service.ts` — `lerArquivoSeguro(filename)`

```typescript
export function lerArquivoSeguro(filename: string): fs.ReadStream {
    const filepath = path.join(UPLOAD_DIR, filename);
    if (!filepath.startsWith(UPLOAD_DIR)) throw new Error('Acesso negado.');
    if (!fs.existsSync(filepath)) throw new Error('Arquivo não encontrado.');
    return fs.createReadStream(filepath);
}
```
**How it works:** Monta o caminho real e bloqueia requisições que tentem escapar da pasta `/uploads/carros` usando `../`, além de servir como stream para economizar RAM.

## Key Design Decisions
- Utilizou-se o UUID gerado pelo servidor ao invés de aceitar o nome original para evitar injeções ou nomes quebrados.
- Foi mantido no disco local para baratear custos da locadora, aceitando o trade-off de que não será um CDN global. A chave `X-API-KEY` reduz os riscos de abuso.
- Optou-se por separar a rota de imagem da rota de criação do veículo. Assim o gerenciamento das fotos da galeria é independente dos dados do veículo.

## Security Controls Active
- [x] Type validation (somente `image/*`)
- [x] Size limits (máximo 5MB)
- [x] Signed URLs (Não aplicável, substituído por API KEY header)
- [x] Access control (Admin para Escrita, Frontend via API KEY para leitura)
- [ ] Audit logging

## Changelog

### v1 — 2026-04-29
- Implementado armazenamento de arquivos com `formidable`.
- Tabela `veiculo_imagem` adicionada ao banco PostgreSQL.
- Criada as lógicas de leitura segura via streams do Node.js.
