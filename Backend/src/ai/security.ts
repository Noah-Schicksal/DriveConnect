/**
 * SEGURANÇA AVANÇADA PARA AI AGENT
 * - Rate limiting por telefone
 * - Auditoria persistente em DB
 * - Proteção contra prompt injection
 * - Sanitização de dados sensíveis
 */

import 'dotenv/config';
import { query } from '../db/index.js';

// TIPOS
export interface SecurityConfig {
  rateLimit: {
    enabled: boolean;
    requests_per_minute: number;
    requests_per_hour: number;
  };
  audit: {
    enabled: boolean;
    persist_to_db: boolean;
  };
  sanitization: {
    remove_pii: boolean;
    remove_tokens: boolean;
    max_input_length: number;
    max_output_length: number;
  };
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  reset_at: Date;
  reason?: string;
}

export interface SecurityEvent {
  id?: string;
  timestamp: string;
  tipo: 'REQUEST' | 'TOOL_CALL' | 'ERROR' | 'SUSPICIOUS' | 'INJECTION_ATTEMPT';
  telefone: string;
  cliente_id?: string | null;
  descricao: string;
  dados_json?: object;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

// CONFIGURAÇÃO PADRÃO
const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  rateLimit: {
    enabled: process.env.SECURITY_RATE_LIMIT_ENABLED !== 'false',
    requests_per_minute: 5,
    requests_per_hour: 30,
  },
  audit: {
    enabled: process.env.SECURITY_AUDIT_ENABLED !== 'false',
    persist_to_db: process.env.SECURITY_AUDIT_DB === 'true',
  },
  sanitization: {
    remove_pii: process.env.SECURITY_SANITIZE_PII !== 'false',
    remove_tokens: process.env.SECURITY_SANITIZE_TOKENS !== 'false',
    max_input_length: 1000,
    max_output_length: 2000,
  },
};

const DEFAULT_CONFIG = DEFAULT_SECURITY_CONFIG;

// RATE LIMITER (IN-MEMORY COM TTL)
interface RateLimitEntry {
  timestamps: number[];
  blocked_until?: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

function normalizePhoneNumber(telefone: string): string {
  // Remove não-dígitos, normaliza
  return telefone.replace(/\D/g, '').slice(-11); // Últimos 11 dígitos (BR)
}

export function checkRateLimit(telefone: string, config = DEFAULT_CONFIG): RateLimitResult {
  if (!config.rateLimit.enabled) {
    return {
      allowed: true,
      remaining: config.rateLimit.requests_per_minute,
      reset_at: new Date(Date.now() + 60000),
    };
  }

  const normalizedPhone = normalizePhoneNumber(telefone);
  const now = Date.now();
  const oneMinuteAgo = now - 60000;
  const oneHourAgo = now - 3600000;

  let entry = rateLimitMap.get(normalizedPhone);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitMap.set(normalizedPhone, entry);
  }

  // Limpar timestamps antigos
  entry.timestamps = entry.timestamps.filter((ts) => ts > oneHourAgo);

  // Verificar se bloqueado
  if (entry.blocked_until && now < entry.blocked_until) {
    const resetDate = new Date(entry.blocked_until);
    return {
      allowed: false,
      remaining: 0,
      reset_at: resetDate,
      reason: `Bloqueado até ${resetDate.toISOString()}. Excedeu limite de requisições.`,
    };
  }

  // Contar requisições no último minuto
  const lastMinuteCount = entry.timestamps.filter((ts) => ts > oneMinuteAgo).length;

  if (lastMinuteCount >= config.rateLimit.requests_per_minute) {
    // Bloquear por 5 minutos
    entry.blocked_until = now + 300000;
    console.warn(
      `[SECURITY] Rate limit acionado para ${normalizedPhone}: ${lastMinuteCount} requisições em 1 minuto`,
    );

    logSecurityEvent({
      tipo: 'SUSPICIOUS',
      telefone: normalizedPhone,
      descricao: `Rate limit excedido: ${lastMinuteCount} requisições/min`,
      severity: 'MEDIUM',
      dados_json: { lastMinuteCount, limit: config.rateLimit.requests_per_minute },
    });

    const resetDate = new Date(entry.blocked_until);
    return {
      allowed: false,
      remaining: 0,
      reset_at: resetDate,
      reason: `Muitas requisições. Tente novamente em ${Math.ceil(300 / 60)} minutos.`,
    };
  }

  // Adicionar timestamp
  entry.timestamps.push(now);

  const remaining = config.rateLimit.requests_per_minute - lastMinuteCount - 1;
  return {
    allowed: true,
    remaining: Math.max(0, remaining),
    reset_at: new Date(now + 60000),
  };
}

// PROTEÇÃO CONTRA PROMPT INJECTION
const INJECTION_PATTERNS = [
  /(?:ignore|forget|discard|override).{0,20}(?:instruction|prompt|system|role|rule)/i,
  /(?:pretend|act|simulate|role\s*play).{0,20}(?:you are|you're|your role)/i,
  /(?:forget|ignore).{0,10}(?:previous|prior|earlier).{0,10}instruction/i,
  /---[\s\S]*?---/i, // Delimitadores tipo markdown
  /```[\s\S]*?```/i, // Code blocks
  /\{.*?(?:system|instruction|prompt|rule).*?\}/i, // JSON injection
];

export function detectPromptInjection(text: string): { detected: boolean; confidence: number; pattern?: string } {
  if (!text) return { detected: false, confidence: 0 };

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return {
        detected: true,
        confidence: 0.8,
        pattern: pattern.source,
      };
    }
  }

  // Heurística: muitas quebras de linha ou símbolos especiais
  const specialCharCount = (text.match(/[{}[\]\-\*#\\/]/g) || []).length;
  const confidence = specialCharCount / text.length;
  if (confidence > 0.3) {
    return {
      detected: true,
      confidence: Math.min(0.7, confidence),
      pattern: 'high_special_character_ratio',
    };
  }

  return { detected: false, confidence: 0 };
}

// SANITIZAÇÃO DE DADOS SENSÍVEIS
const PII_PATTERNS = {
  cpf: /(\d{3})\.(\d{3})\.(\d{3})-(\d{2})/g,
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  phone: /\+?55\s?\(?[0-9]{2}\)?\s?[0-9]{4,5}-?[0-9]{4}/g,
  token: /(?:token|apikey|api_key|secret|password)\s*[:=]\s*([a-zA-Z0-9_-]+)/gi,
  card: /[0-9]{4}[\s-]?[0-9]{4}[\s-]?[0-9]{4}[\s-]?[0-9]{4}/g,
};

export function sanitizePII(text: string, config = DEFAULT_CONFIG): string {
  if (!config.sanitization.remove_pii) return text;

  let sanitized = text;

  // CPF: 123.456.789-10 → [CPF]
  sanitized = sanitized.replace(PII_PATTERNS.cpf, '[CPF]');

  // Email: test@example.com → [EMAIL]
  sanitized = sanitized.replace(PII_PATTERNS.email, '[EMAIL]');

  // Telefone: +55 11 98765-4321 → [PHONE]
  sanitized = sanitized.replace(PII_PATTERNS.phone, '[PHONE]');

  // Tokens/Secrets → [TOKEN]
  if (config.sanitization.remove_tokens) {
    sanitized = sanitized.replace(PII_PATTERNS.token, '$1: [TOKEN]');
  }

  // Cartão: 1234 5678 9012 3456 → [CARD]
  sanitized = sanitized.replace(PII_PATTERNS.card, '[CARD]');

  return sanitized;
}

// VALIDAÇÃO E SANITIZAÇÃO DE INPUT
export function validateAndSanitizeInput(
  text: string,
  telefone: string,
  config = DEFAULT_CONFIG,
): {
  valid: boolean;
  sanitized: string;
  reason?: string;
  injection_detected?: boolean;
} {
  // 1. Verificar comprimento
  if (text.length > config.sanitization.max_input_length) {
    return {
      valid: false,
      sanitized: text.slice(0, config.sanitization.max_input_length),
      reason: `Input excede limite de ${config.sanitization.max_input_length} caracteres`,
    };
  }

  // 2. Detectar injection
  const injectionCheck = detectPromptInjection(text);
  if (injectionCheck.detected && injectionCheck.confidence > 0.7) {
    logSecurityEvent({
      tipo: 'INJECTION_ATTEMPT',
      telefone,
      descricao: `Possível prompt injection detectada (confidence: ${injectionCheck.confidence})`,
      severity: 'HIGH',
      dados_json: { pattern: injectionCheck.pattern, confidence: injectionCheck.confidence },
    });

    return {
      valid: false,
      sanitized: text,
      reason: 'Entrada contém padrões suspeitos',
      injection_detected: true,
    };
  }

  // 3. Sanitizar
  let sanitized = text.trim();

  // Remover caracteres de controle
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Normalizar espaços
  sanitized = sanitized.replace(/\s+/g, ' ');

  // Remover PII se configurado
  if (config.sanitization.remove_pii) {
    sanitized = sanitizePII(sanitized, config);
  }

  return { valid: true, sanitized };
}

// LOGGING DE SEGURANÇA
const inMemoryEvents: SecurityEvent[] = [];
const MAX_IN_MEMORY_EVENTS = 1000;

export async function logSecurityEvent(event: Omit<SecurityEvent, 'id' | 'timestamp'>): Promise<void> {
  const fullEvent: SecurityEvent = {
    ...event,
    timestamp: new Date().toISOString(),
  };

  // Armazenar em memória
  inMemoryEvents.push(fullEvent);
  if (inMemoryEvents.length > MAX_IN_MEMORY_EVENTS) {
    inMemoryEvents.shift();
  }

  // Log no console
  const emoji = {
    REQUEST: '📨',
    TOOL_CALL: '🔧',
    ERROR: '❌',
    SUSPICIOUS: '⚠️',
    INJECTION_ATTEMPT: '🚨',
  };

  const colors = {
    LOW: '\x1b[36m',
    MEDIUM: '\x1b[33m',
    HIGH: '\x1b[31m',
    CRITICAL: '\x1b[35m',
    RESET: '\x1b[0m',
  };

  const color = colors[event.severity];
  console.log(
    `${color}${emoji[event.tipo]} [SECURITY] ${event.tipo} | ${event.telefone} | ${event.descricao}${colors.RESET}`,
  );

  // Persistir em DB se configurado
  if (DEFAULT_CONFIG.audit.persist_to_db) {
    try {
      await query(
        `INSERT INTO security_events 
         (tipo, telefone, cliente_id, descricao, dados_json, severity, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          event.tipo,
          event.telefone,
          event.cliente_id || null,
          event.descricao,
          event.dados_json ? JSON.stringify(event.dados_json) : null,
          event.severity,
        ],
      );
    } catch (err) {
      console.error('[SECURITY] Erro ao persistir evento em DB:', err);
    }
  }
}

// QUERY SOBRE EVENTOS
export function getSecurityEvents(
  filtros?: {
    telefone?: string;
    tipo?: string;
    severity?: string;
    last_n?: number;
  },
): SecurityEvent[] {
  let events = [...inMemoryEvents];

  if (filtros?.telefone) {
    events = events.filter((e) => e.telefone === filtros.telefone);
  }

  if (filtros?.tipo) {
    events = events.filter((e) => e.tipo === filtros.tipo);
  }

  if (filtros?.severity) {
    events = events.filter((e) => e.severity === filtros.severity);
  }

  const lastN = filtros?.last_n || 50;
  return events.slice(-lastN);
}

// SETUP INICIAL (CRIAR TABELA)
export async function initSecurityDatabase(): Promise<void> {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS security_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tipo VARCHAR(50) NOT NULL,
        telefone VARCHAR(20) NOT NULL,
        cliente_id UUID,
        descricao TEXT NOT NULL,
        dados_json JSONB,
        severity VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW(),
        INDEX idx_telefone (telefone),
        INDEX idx_created_at (created_at)
      )
    `);

    console.log('✅ Tabela security_events criada/verificada');
  } catch (err) {
    console.error('[SECURITY] Erro ao inicializar DB:', err);
  }
}

// EXPORTS
export { DEFAULT_CONFIG };

export function getSecurityStats(): {
  rate_limit_blocks: number;
  injection_attempts: number;
  errors_last_hour: number;
} {
  const now = Date.now();
  const oneHourAgo = now - 3600000;

  const recentEvents = inMemoryEvents.filter((e) => new Date(e.timestamp).getTime() > oneHourAgo);

  return {
    rate_limit_blocks: recentEvents.filter((e) => e.tipo === 'SUSPICIOUS').length,
    injection_attempts: recentEvents.filter((e) => e.tipo === 'INJECTION_ATTEMPT').length,
    errors_last_hour: recentEvents.filter((e) => e.tipo === 'ERROR').length,
  };
}
