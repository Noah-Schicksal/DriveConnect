-- Extensões úteis
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- USUÁRIO (autenticação central)
CREATE TABLE usuario (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    senha TEXT NOT NULL,
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('CLIENTE', 'FRANQUIA', 'ADMIN')),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deletado_em TIMESTAMP
);

-- CLIENTE
CREATE TABLE cliente (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id UUID UNIQUE REFERENCES usuario(id),
    nome_completo VARCHAR(255) NOT NULL,
    cpf VARCHAR(14) UNIQUE NOT NULL,
    rg VARCHAR(20),
    cnh VARCHAR(20),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deletado_em TIMESTAMP
);

-- FRANQUIA
CREATE TABLE franquia (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id UUID UNIQUE REFERENCES usuario(id),
    nome VARCHAR(255) NOT NULL,
    cnpj VARCHAR(18) UNIQUE NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deletado_em TIMESTAMP
);

-- FILIAL
CREATE TABLE filial (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deletado_em TIMESTAMP
);

-- TIPO DE CARRO (categoria)
CREATE TABLE tipo_carro (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(50) NOT NULL,
    preco_base_diaria DECIMAL(10,2) NOT NULL
);

-- MODELO
CREATE TABLE modelo (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    marca VARCHAR(100),
    tipo_carro_id INT REFERENCES tipo_carro(id)
);

-- VEÍCULO (carro real)
CREATE TABLE veiculo (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    modelo_id INT REFERENCES modelo(id),
    filial_id UUID REFERENCES filial(id),
    placa VARCHAR(10) UNIQUE NOT NULL,
    ano INT NOT NULL,
    cor VARCHAR(50),
    status VARCHAR(20) NOT NULL CHECK (status IN ('DISPONIVEL', 'ALUGADO', 'MANUTENCAO')),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deletado_em TIMESTAMP
);

-- RESERVA / ALUGUEL
CREATE TABLE reserva (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cliente_id UUID REFERENCES cliente(id),
    veiculo_id UUID REFERENCES veiculo(id),
    filial_retirada_id UUID REFERENCES filial(id),
    filial_devolucao_id UUID REFERENCES filial(id),
    data_inicio TIMESTAMP NOT NULL,
    data_fim TIMESTAMP NOT NULL,
    data_retirada_real TIMESTAMP,
    data_devolucao_real TIMESTAMP,
    valor_total DECIMAL(10,2),
    status VARCHAR(20) NOT NULL CHECK (status IN ('RESERVADA', 'ATIVA', 'FINALIZADA', 'CANCELADA')),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deletado_em TIMESTAMP
);

-- TABELA DE PREÇO DINÂMICO
CREATE TABLE tabela_preco (
    id SERIAL PRIMARY KEY,
    tipo_carro_id INT REFERENCES tipo_carro(id),
    filial_id UUID REFERENCES filial(id),
    data_inicio DATE,
    data_fim DATE,
    valor_diaria DECIMAL(10,2) NOT NULL
);

-- CONTROLE FINANCEIRO
CREATE TABLE transacao (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filial_id UUID REFERENCES filial(id),
    tipo VARCHAR(20) CHECK (tipo IN ('ENTRADA', 'SAIDA')),
    valor DECIMAL(10,2),
    descricao TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deletado_em TIMESTAMP
);

-- ÍNDICES (performance)
CREATE INDEX idx_veiculo_filial ON veiculo(filial_id);
CREATE INDEX idx_reserva_veiculo ON reserva(veiculo_id);
CREATE INDEX idx_reserva_cliente ON reserva(cliente_id);
CREATE INDEX idx_reserva_periodo ON reserva(data_inicio, data_fim);
