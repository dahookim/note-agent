import { requestUrl, RequestUrlParam } from 'obsidian';
import {
  OSBASettings,
  AIProvider,
  GenerateOptions,
  GenerateResult,
  EmbeddingResult,
  ProviderType,
  APIError,
  RateLimitError,
} from '../types';

// ============================================
// Model Configuration
// ============================================

interface ModelConfig {
  id: string;
  provider: ProviderType;
  inputCostPer1M: number;  // USD per 1M tokens
  outputCostPer1M: number;
  maxInputTokens: number;
  maxOutputTokens: number;
}

const MODEL_CONFIGS: Record<string, ModelConfig> = {
  // Gemini Models
  'gemini-flash': {
    id: 'gemini-2.0-flash-exp',
    provider: 'gemini',
    inputCostPer1M: 0.075,
    outputCostPer1M: 0.30,
    maxInputTokens: 1000000,
    maxOutputTokens: 8192,
  },
  'gemini-pro': {
    id: 'gemini-1.5-pro',
    provider: 'gemini',
    inputCostPer1M: 1.25,
    outputCostPer1M: 5.00,
    maxInputTokens: 2000000,
    maxOutputTokens: 8192,
  },

  // Claude Models
  'claude-sonnet': {
    id: 'claude-3-5-sonnet-20241022',
    provider: 'claude',
    inputCostPer1M: 3.00,
    outputCostPer1M: 15.00,
    maxInputTokens: 200000,
    maxOutputTokens: 8192,
  },
  'claude-opus': {
    id: 'claude-3-opus-20240229',
    provider: 'claude',
    inputCostPer1M: 15.00,
    outputCostPer1M: 75.00,
    maxInputTokens: 200000,
    maxOutputTokens: 4096,
  },

  // OpenAI Embedding Models
  'openai-small': {
    id: 'text-embedding-3-small',
    provider: 'openai',
    inputCostPer1M: 0.02,
    outputCostPer1M: 0,
    maxInputTokens: 8191,
    maxOutputTokens: 0,
  },
  'openai-large': {
    id: 'text-embedding-3-large',
    provider: 'openai',
    inputCostPer1M: 0.13,
    outputCostPer1M: 0,
    maxInputTokens: 8191,
    maxOutputTokens: 0,
  },
};

// ============================================
// API Endpoints
// ============================================

const API_ENDPOINTS = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  claude: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
};

// ============================================
// AI Provider Manager
// ============================================

export class AIProviderManager {
  private settings: OSBASettings;
  private retryDelays = [1000, 2000, 4000]; // Exponential backoff

  constructor(settings: OSBASettings) {
    this.settings = settings;
  }

  updateSettings(settings: OSBASettings): void {
    this.settings = settings;
  }

  // ============================================
  // Text Generation
  // ============================================

  async generateText(
    modelKey: string,
    prompt: string,
    options: GenerateOptions = {}
  ): Promise<GenerateResult> {
    const config = MODEL_CONFIGS[modelKey];
    if (!config) {
      throw new APIError(`Unknown model: ${modelKey}`, 'gemini', 400);
    }

    switch (config.provider) {
      case 'gemini':
        return this.generateWithGemini(config, prompt, options);
      case 'claude':
        return this.generateWithClaude(config, prompt, options);
      default:
        throw new APIError(`Provider ${config.provider} does not support text generation`, config.provider, 400);
    }
  }

  private async generateWithGemini(
    config: ModelConfig,
    prompt: string,
    options: GenerateOptions
  ): Promise<GenerateResult> {
    const apiKey = this.settings.geminiApiKey;
    if (!apiKey) {
      throw new APIError('Gemini API key not configured', 'gemini', 401);
    }

    const url = `${API_ENDPOINTS.gemini}/models/${config.id}:generateContent?key=${apiKey}`;

    const body = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        maxOutputTokens: options.maxTokens || config.maxOutputTokens,
        temperature: options.temperature ?? 0.7,
        topP: options.topP ?? 0.95,
        stopSequences: options.stopSequences || [],
      },
    };

    if (options.systemPrompt) {
      body.contents.unshift({
        role: 'user',
        parts: [{ text: `System: ${options.systemPrompt}` }]
      } as any);
    }

    const response = await this.makeRequest({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 'gemini');

    const data = JSON.parse(response);

    if (!data.candidates || data.candidates.length === 0) {
      throw new APIError('No response from Gemini', 'gemini', 500);
    }

    const candidate = data.candidates[0];
    const text = candidate.content?.parts?.[0]?.text || '';

    // Estimate tokens (Gemini doesn't always return token counts)
    const inputTokens = data.usageMetadata?.promptTokenCount || this.estimateTokens(prompt);
    const outputTokens = data.usageMetadata?.candidatesTokenCount || this.estimateTokens(text);

    return {
      text,
      inputTokens,
      outputTokens,
      cost: this.calculateCost(config, inputTokens, outputTokens),
      model: config.id,
      finishReason: candidate.finishReason === 'STOP' ? 'stop' : 'length',
    };
  }

  private async generateWithClaude(
    config: ModelConfig,
    prompt: string,
    options: GenerateOptions
  ): Promise<GenerateResult> {
    const apiKey = this.settings.claudeApiKey;
    if (!apiKey) {
      throw new APIError('Claude API key not configured', 'claude', 401);
    }

    const url = `${API_ENDPOINTS.claude}/messages`;

    const body: Record<string, unknown> = {
      model: config.id,
      max_tokens: options.maxTokens || config.maxOutputTokens,
      messages: [{ role: 'user', content: prompt }],
    };

    if (options.systemPrompt) {
      body.system = options.systemPrompt;
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    if (options.topP !== undefined) {
      body.top_p = options.topP;
    }

    if (options.stopSequences) {
      body.stop_sequences = options.stopSequences;
    }

    const response = await this.makeRequest({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    }, 'claude');

    const data = JSON.parse(response);

    const text = data.content?.[0]?.text || '';

    return {
      text,
      inputTokens: data.usage?.input_tokens || 0,
      outputTokens: data.usage?.output_tokens || 0,
      cost: this.calculateCost(config, data.usage?.input_tokens || 0, data.usage?.output_tokens || 0),
      model: config.id,
      finishReason: data.stop_reason === 'end_turn' ? 'stop' : 'length',
    };
  }

  // ============================================
  // Embedding Generation
  // ============================================

  async generateEmbedding(text: string, modelKey?: string): Promise<EmbeddingResult> {
    const model = modelKey || this.settings.embeddingModel;
    const config = MODEL_CONFIGS[model];

    if (!config || config.provider !== 'openai') {
      throw new APIError('Invalid embedding model', 'openai', 400);
    }

    return this.generateWithOpenAI(config, text);
  }

  private async generateWithOpenAI(
    config: ModelConfig,
    text: string
  ): Promise<EmbeddingResult> {
    const apiKey = this.settings.openaiApiKey;
    if (!apiKey) {
      throw new APIError('OpenAI API key not configured', 'openai', 401);
    }

    const url = `${API_ENDPOINTS.openai}/embeddings`;

    // Truncate text if too long
    const truncatedText = text.length > 8000 * 4 ? text.slice(0, 8000 * 4) : text;

    const body = {
      model: config.id,
      input: truncatedText,
    };

    const response = await this.makeRequest({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    }, 'openai');

    const data = JSON.parse(response);

    if (!data.data || data.data.length === 0) {
      throw new APIError('No embedding returned from OpenAI', 'openai', 500);
    }

    const embedding = data.data[0].embedding;
    const inputTokens = data.usage?.total_tokens || this.estimateTokens(truncatedText);

    return {
      embedding,
      inputTokens,
      cost: this.calculateCost(config, inputTokens, 0),
      model: config.id,
      dimensions: embedding.length,
    };
  }

  // ============================================
  // Request Handling with Retry
  // ============================================

  private async makeRequest(
    params: RequestUrlParam,
    provider: ProviderType,
    retryCount: number = 0
  ): Promise<string> {
    try {
      const response = await requestUrl(params);

      if (response.status >= 200 && response.status < 300) {
        return response.text;
      }

      // Handle specific error codes
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers['retry-after'] || '60');
        throw new RateLimitError(provider, retryAfter);
      }

      if (response.status === 401 || response.status === 403) {
        throw new APIError('Invalid API key', provider, response.status, false);
      }

      throw new APIError(
        `API request failed: ${response.status}`,
        provider,
        response.status
      );

    } catch (error) {
      if (error instanceof RateLimitError || error instanceof APIError) {
        // Retry if recoverable and we haven't exceeded retry limit
        if (error.recoverable && retryCount < this.retryDelays.length) {
          const delay = error instanceof RateLimitError
            ? (error.retryAfter || 60) * 1000
            : this.retryDelays[retryCount];

          console.log(`Retrying ${provider} request in ${delay}ms...`);
          await this.sleep(delay);
          return this.makeRequest(params, provider, retryCount + 1);
        }
        throw error;
      }

      // Network or other errors
      if (retryCount < this.retryDelays.length) {
        await this.sleep(this.retryDelays[retryCount]);
        return this.makeRequest(params, provider, retryCount + 1);
      }

      throw new APIError(
        `Network error: ${error instanceof Error ? error.message : 'Unknown'}`,
        provider,
        0
      );
    }
  }

  // ============================================
  // Utility Methods
  // ============================================

  private calculateCost(
    config: ModelConfig,
    inputTokens: number,
    outputTokens: number
  ): number {
    const inputCost = (inputTokens / 1000000) * config.inputCostPer1M;
    const outputCost = (outputTokens / 1000000) * config.outputCostPer1M;
    return inputCost + outputCost;
  }

  private estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token for English
    // More accurate for mixed content
    return Math.ceil(text.length / 4);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================
  // Provider Availability
  // ============================================

  async testConnection(provider: ProviderType): Promise<{ success: boolean; error?: string }> {
    try {
      switch (provider) {
        case 'gemini':
          if (!this.settings.geminiApiKey) {
            return { success: false, error: 'API key not set' };
          }
          await this.generateText('gemini-flash', 'Say "OK"', { maxTokens: 10 });
          return { success: true };

        case 'claude':
          if (!this.settings.claudeApiKey) {
            return { success: false, error: 'API key not set' };
          }
          await this.generateText('claude-sonnet', 'Say "OK"', { maxTokens: 10 });
          return { success: true };

        case 'openai':
          if (!this.settings.openaiApiKey) {
            return { success: false, error: 'API key not set' };
          }
          await this.generateEmbedding('test');
          return { success: true };

        default:
          return { success: false, error: 'Unknown provider' };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed'
      };
    }
  }

  isProviderConfigured(provider: ProviderType): boolean {
    switch (provider) {
      case 'gemini':
        return !!this.settings.geminiApiKey;
      case 'claude':
        return !!this.settings.claudeApiKey;
      case 'openai':
        return !!this.settings.openaiApiKey;
      default:
        return false;
    }
  }

  getModelConfig(modelKey: string): ModelConfig | undefined {
    return MODEL_CONFIGS[modelKey];
  }

  getAvailableModels(type: 'generation' | 'embedding'): string[] {
    return Object.entries(MODEL_CONFIGS)
      .filter(([_, config]) => {
        if (type === 'embedding') {
          return config.provider === 'openai';
        }
        return config.provider === 'gemini' || config.provider === 'claude';
      })
      .filter(([_, config]) => this.isProviderConfigured(config.provider))
      .map(([key, _]) => key);
  }
}
