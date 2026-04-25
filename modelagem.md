🧱 🧠 MODELO FINAL (estrutura limpa)
🔐 USUÁRIO (autenticação central)
CREATE TABLE usuario (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    senha TEXT NOT NULL,
    tipo VARCHAR(20) NOT NULL, -- cliente, franquia, admin
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
👤 CLIENTE
CREATE TABLE cliente (
    id UUID PRIMARY KEY,
    usuario_id UUID UNIQUE REFERENCES usuario(id),
    nome_completo VARCHAR(255) NOT NULL,
    cpf VARCHAR(14) UNIQUE NOT NULL,
    rg VARCHAR(20),
    cnh VARCHAR(20),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
🏢 FRANQUIA
CREATE TABLE franquia (
    id UUID PRIMARY KEY,
    usuario_id UUID UNIQUE REFERENCES usuario(id),
    nome VARCHAR(255) NOT NULL,
    cnpj VARCHAR(18) UNIQUE NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
🏬 FILIAL
CREATE TABLE filial (
    id UUID PRIMARY KEY,
    franquia_id UUID REFERENCES franquia(id),
    nome VARCHAR(255),

    cep VARCHAR(10),
    uf VARCHAR(2),
    cidade VARCHAR(100),
    bairro VARCHAR(100),
    rua VARCHAR(255),
    numero VARCHAR(10),
    complemento VARCHAR(100),

    ativo BOOLEAN DEFAULT TRUE,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
🚗 TIPO DE CARRO (categoria)
CREATE TABLE tipo_carro (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(50) NOT NULL,
    preco_base_diaria DECIMAL(10,2) NOT NULL
);
🚘 MODELO
CREATE TABLE modelo (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    marca VARCHAR(100),
    tipo_carro_id INT REFERENCES tipo_carro(id)
);
🚙 VEÍCULO (carro real)
CREATE TABLE veiculo (
    id UUID PRIMARY KEY,
    modelo_id INT REFERENCES modelo(id),
    filial_id UUID REFERENCES filial(id),

    placa VARCHAR(10) UNIQUE NOT NULL,
    ano INT NOT NULL,
    cor VARCHAR(50),

    status VARCHAR(20) NOT NULL, -- disponível, alugado, manutenção
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
📅 RESERVA / ALUGUEL
CREATE TABLE reserva (
    id UUID PRIMARY KEY,

    cliente_id UUID REFERENCES cliente(id),
    veiculo_id UUID REFERENCES veiculo(id),

    filial_retirada_id UUID REFERENCES filial(id),
    filial_devolucao_id UUID REFERENCES filial(id),

    data_inicio TIMESTAMP NOT NULL,
    data_fim TIMESTAMP NOT NULL,

    data_retirada_real TIMESTAMP,
    data_devolucao_real TIMESTAMP,

    valor_total DECIMAL(10,2),

    status VARCHAR(20) NOT NULL, -- reservada, ativa, finalizada, cancelada

    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
💰 (OPCIONAL, MAS PROFISSIONAL) TABELA DE PREÇO DINÂMICO
CREATE TABLE tabela_preco (
    id SERIAL PRIMARY KEY,
    tipo_carro_id INT REFERENCES tipo_carro(id),
    filial_id UUID REFERENCES filial(id),

    data_inicio DATE,
    data_fim DATE,

    valor_diaria DECIMAL(10,2) NOT NULL
);

👉 Se não tiver registro aqui → usa preco_base_diaria

💳 (RECOMENDADO) CONTROLE FINANCEIRO
CREATE TABLE transacao (
    id UUID PRIMARY KEY,
    filial_id UUID REFERENCES filial(id),

    tipo VARCHAR(20), -- entrada / saida
    valor DECIMAL(10,2),

    descricao TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

👉 Isso substitui completamente o saldo

⚡ ÍNDICES IMPORTANTES (performance)
CREATE INDEX idx_veiculo_filial ON veiculo(filial_id);
CREATE INDEX idx_reserva_veiculo ON reserva(veiculo_id);
CREATE INDEX idx_reserva_cliente ON reserva(cliente_id);
CREATE INDEX idx_reserva_periodo ON reserva(data_inicio, data_fim);
🧠 LÓGICA IMPORTANTE (ESSENCIAL)
🚗 Ver veículos disponíveis
SELECT *
FROM veiculo v
WHERE v.status = 'disponível'
AND NOT EXISTS (
    SELECT 1 FROM reserva r
    WHERE r.veiculo_id = v.id
    AND r.status IN ('reservada', 'ativa')
    AND r.data_inicio < :data_fim
    AND r.data_fim > :data_inicio
);