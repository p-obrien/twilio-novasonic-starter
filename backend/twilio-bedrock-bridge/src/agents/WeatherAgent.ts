/**
 * @fileoverview Weather Agent for Bedrock Agent Core Integration
 * 
 * Provides weather functionality through AWS Bedrock Agent Core,
 * integrating with the WeatherTool for voice-optimized weather responses.
 */

import { AgentCoreManager, AgentCoreConfig, NovaToolUseEvent, NovaToolResult } from './AgentCoreManager';
import { weatherTool, WeatherToolInput } from '../tools/WeatherTool';
import { toolRegistry, ToolCategory } from './ToolRegistry';
import logger from '../observability/logger';
import { CorrelationIdManager } from '../utils/correlationId';
import { extractErrorDetails } from '../errors/ClientErrors';

/**
 * Weather Agent Configuration
 */
export interface WeatherAgentConfig extends AgentCoreConfig {
  /** Weather API key for external weather service */
  weatherApiKey?: string;
  /** Enable weather caching */
  enableCaching?: boolean;
  /** Default temperature units */
  defaultUnits?: 'celsius' | 'fahrenheit';
  /** Include forecast in responses */
  includeForecast?: boolean;
}

/**
 * Weather Agent for voice conversations
 * 
 * Handles weather-related queries through Bedrock Agent Core,
 * providing natural voice responses for weather information.
 */
export class WeatherAgent {
  private readonly agentCoreManager: AgentCoreManager;
  private readonly config: WeatherAgentConfig;

  constructor(config: WeatherAgentConfig, clientConfig?: any) {
    this.config = {
      defaultUnits: 'fahrenheit',
      enableCaching: true,
      includeForecast: true,
      ...config
    };

    // Initialize Agent Core Manager
    this.agentCoreManager = new AgentCoreManager(this.config, clientConfig);

    // Register weather tools
    this.registerWeatherTools();

    logger.info('Weather Agent initialized', {
      agentId: this.config.agentId,
      defaultUnits: this.config.defaultUnits,
      enableCaching: this.config.enableCaching,
      correlationId: CorrelationIdManager.getCurrentCorrelationId()
    });
  }

  /**
   * Execute weather tool request
   */
  public async executeWeatherRequest(toolUse: NovaToolUseEvent): Promise<NovaToolResult> {
    const startTime = Date.now();
    const correlationId = CorrelationIdManager.getCurrentCorrelationId();

    logger.info('Executing weather request', {
      toolUseId: toolUse.toolUseId,
      toolName: toolUse.name,
      location: toolUse.input.location,
      correlationId
    });

    try {
      // Validate weather tool request
      if (toolUse.name !== 'get_weather') {
        throw new Error(`Unsupported weather tool: ${toolUse.name}`);
      }

      // Prepare weather tool input
      const weatherInput: WeatherToolInput = {
        location: toolUse.input.location,
        units: toolUse.input.units || this.config.defaultUnits,
        includeForecast: this.config.includeForecast,
        includeHourly: false // Keep voice responses concise
      };

      // Execute weather tool directly
      const weatherResult = await weatherTool.execute(weatherInput);

      if (!weatherResult.success) {
        throw new Error(weatherResult.error || 'Weather tool execution failed');
      }

      const executionTime = Date.now() - startTime;

      logger.info('Weather request completed successfully', {
        toolUseId: toolUse.toolUseId,
        location: weatherInput.location,
        executionTime,
        correlationId
      });

      return {
        toolUseId: toolUse.toolUseId,
        content: [{ text: weatherResult.speechText }],
        status: 'success'
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      logger.error('Weather request failed', {
        toolUseId: toolUse.toolUseId,
        location: toolUse.input.location,
        executionTime,
        error: extractErrorDetails(error),
        correlationId
      });

      return {
        toolUseId: toolUse.toolUseId,
        content: [{ 
          text: this.formatWeatherError(error, toolUse.input.location) 
        }],
        status: 'error'
      };
    }
  }

  /**
   * Execute weather request via Agent Core (alternative method)
   */
  public async executeViaAgentCore(toolUse: NovaToolUseEvent): Promise<NovaToolResult> {
    return this.agentCoreManager.executeTool(toolUse, this.config);
  }

  /**
   * Register weather tools with the tool registry
   */
  private registerWeatherTools(): void {
    // Register the main weather tool
    toolRegistry.registerTool('get_weather', {
      definition: {
        toolSpec: {
          name: 'get_weather',
          description: 'Get current weather conditions and forecast for any location worldwide',
          inputSchema: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description: 'City name, state, country, or address for weather lookup (e.g., "New York", "London, UK", "San Francisco, CA")'
              },
              units: {
                type: 'string',
                description: 'Temperature units preference',
                enum: ['celsius', 'fahrenheit']
              },
              include_forecast: {
                type: 'string',
                description: 'Include today\'s forecast information',
                enum: ['true', 'false']
              }
            },
            required: ['location']
          }
        }
      },
      metadata: {
        expectedExecutionTime: 3000, // 3 seconds for weather API calls
        supportsRealTime: true,
        voiceDescription: 'Get current weather conditions, temperature, and forecast for any location',
        examplePhrases: [
          'What\'s the weather like in New York?',
          'How\'s the weather today?',
          'Is it raining in Seattle?',
          'What\'s the temperature in London?',
          'Weather forecast for San Francisco',
          'Current conditions in Miami',
          'Will it rain today in Chicago?',
          'Temperature in Tokyo right now'
        ],
        category: ToolCategory.INFORMATION,
        requiredCapabilities: ['real_time_response']
      },
      agentId: this.config.agentId
    });

    // Register a simplified weather check tool
    toolRegistry.registerTool('check_weather', {
      definition: {
        toolSpec: {
          name: 'check_weather',
          description: 'Quick weather check for current conditions only',
          inputSchema: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description: 'Location for weather check'
              }
            },
            required: ['location']
          }
        }
      },
      metadata: {
        expectedExecutionTime: 2000, // Faster for simple checks
        supportsRealTime: true,
        voiceDescription: 'Quick check of current weather conditions',
        examplePhrases: [
          'Check the weather',
          'Quick weather update',
          'Current weather please'
        ],
        category: ToolCategory.INFORMATION
      },
      agentId: this.config.agentId
    });

    logger.info('Weather tools registered successfully', {
      agentId: this.config.agentId,
      toolsRegistered: ['get_weather', 'check_weather']
    });
  }

  /**
   * Format weather error for voice output
   */
  private formatWeatherError(error: unknown, location?: string): string {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const locationText = location ? ` for ${location}` : '';

    if (errorMessage.includes('not found')) {
      return `I couldn't find weather information${locationText}. Please try a different location or be more specific.`;
    }

    if (errorMessage.includes('timeout')) {
      return `The weather service is taking too long to respond. Please try again in a moment.`;
    }

    if (errorMessage.includes('authentication') || errorMessage.includes('API key')) {
      return `I'm having trouble accessing the weather service right now. Please try again later.`;
    }

    if (errorMessage.includes('rate limit')) {
      return `I've made too many weather requests recently. Please wait a moment and try again.`;
    }

    return `I'm sorry, I couldn't get the weather information${locationText} right now. Please try again.`;
  }

  /**
   * Get weather agent statistics
   */
  public getStats() {
    return {
      agentCore: this.agentCoreManager.getStats(),
      weatherTool: weatherTool.getCacheStats(),
      configuration: {
        agentId: this.config.agentId,
        defaultUnits: this.config.defaultUnits,
        enableCaching: this.config.enableCaching,
        includeForecast: this.config.includeForecast
      }
    };
  }

  /**
   * Update weather agent configuration
   */
  public updateConfig(updates: Partial<WeatherAgentConfig>): void {
    Object.assign(this.config, updates);
    
    logger.info('Weather agent configuration updated', {
      agentId: this.config.agentId,
      updates: Object.keys(updates),
      correlationId: CorrelationIdManager.getCurrentCorrelationId()
    });
  }

  /**
   * Clear weather cache
   */
  public clearCache(): void {
    weatherTool.clearCache();
    this.agentCoreManager.clearSessionCache();
    
    logger.info('Weather agent cache cleared', {
      agentId: this.config.agentId
    });
  }

  /**
   * Test weather functionality
   */
  public async testWeather(location: string = 'New York'): Promise<boolean> {
    try {
      const testToolUse: NovaToolUseEvent = {
        toolUseId: `test-${Date.now()}`,
        name: 'get_weather',
        input: { location }
      };

      const result = await this.executeWeatherRequest(testToolUse);
      
      logger.info('Weather agent test completed', {
        location,
        success: result.status === 'success',
        response: result.content[0]?.text?.substring(0, 100)
      });

      return result.status === 'success';

    } catch (error) {
      logger.error('Weather agent test failed', {
        location,
        error: extractErrorDetails(error)
      });
      return false;
    }
  }

  /**
   * Cleanup weather agent resources
   */
  public async cleanup(): Promise<void> {
    await this.agentCoreManager.cleanup();
    this.clearCache();
    
    logger.info('Weather agent cleanup completed', {
      agentId: this.config.agentId
    });
  }
}

/**
 * Create weather agent instance with environment configuration
 */
export function createWeatherAgent(agentConfig: WeatherAgentConfig): WeatherAgent {
  // Add environment variables for weather API
  const config: WeatherAgentConfig = {
    ...agentConfig,
    weatherApiKey: agentConfig.weatherApiKey || process.env.WEATHER_API_KEY,
    defaultUnits: agentConfig.defaultUnits || (process.env.DEFAULT_WEATHER_UNITS as 'celsius' | 'fahrenheit') || 'fahrenheit'
  };

  return new WeatherAgent(config);
}

// Export types
export type { WeatherAgentConfig as WeatherConfig };