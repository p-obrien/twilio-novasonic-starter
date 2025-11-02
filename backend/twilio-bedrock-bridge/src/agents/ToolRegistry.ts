/**
 * @fileoverview Tool Registry for Agent Core Integration
 * 
 * Manages available tools and their definitions for Nova Sonic tool usage.
 * Provides tool discovery, validation, and configuration for voice-optimized agents.
 */

import logger from '../observability/logger';
import { CorrelationIdManager } from '../utils/correlationId';

/**
 * Tool definition for Nova Sonic
 */
export interface NovaToolDefinition {
  toolSpec: {
    name: string;
    description: string;
    inputSchema: {
      type: 'object';
      properties: Record<string, {
        type: string;
        description: string;
        enum?: string[];
        items?: any;
      }>;
      required?: string[];
    };
  };
}

/**
 * Tool metadata for voice interactions
 */
export interface VoiceToolMetadata {
  /** Expected execution time (ms) */
  expectedExecutionTime: number;
  /** Whether tool supports real-time execution */
  supportsRealTime: boolean;
  /** Voice-friendly description */
  voiceDescription: string;
  /** Example usage phrases */
  examplePhrases: string[];
  /** Tool category */
  category: ToolCategory;
  /** Required agent capabilities */
  requiredCapabilities?: string[];
}

/**
 * Tool categories for organization
 */
export enum ToolCategory {
  INFORMATION = 'information',
  COMMUNICATION = 'communication',
  PRODUCTIVITY = 'productivity',
  ENTERTAINMENT = 'entertainment',
  UTILITY = 'utility',
  CUSTOM = 'custom'
}

/**
 * Complete tool registration
 */
export interface ToolRegistration {
  definition: NovaToolDefinition;
  metadata: VoiceToolMetadata;
  agentId?: string; // Optional: specific agent for this tool
}

/**
 * Tool Registry for managing available tools
 */
export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools = new Map<string, ToolRegistration>();
  private toolsByCategory = new Map<ToolCategory, Set<string>>();
  private toolsByAgent = new Map<string, Set<string>>();

  private constructor() {
    this.initializeDefaultTools();
  }

  public static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  /**
   * Register a new tool
   */
  public registerTool(toolName: string, registration: ToolRegistration): void {
    try {
      this.validateToolRegistration(toolName, registration);
      
      this.tools.set(toolName, registration);
      
      // Update category index
      if (!this.toolsByCategory.has(registration.metadata.category)) {
        this.toolsByCategory.set(registration.metadata.category, new Set());
      }
      this.toolsByCategory.get(registration.metadata.category)!.add(toolName);
      
      // Update agent index if specified
      if (registration.agentId) {
        if (!this.toolsByAgent.has(registration.agentId)) {
          this.toolsByAgent.set(registration.agentId, new Set());
        }
        this.toolsByAgent.get(registration.agentId)!.add(toolName);
      }
      
      logger.info('Tool registered successfully', {
        toolName,
        category: registration.metadata.category,
        agentId: registration.agentId,
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
      
    } catch (error) {
      logger.error('Failed to register tool', {
        toolName,
        error: error instanceof Error ? error.message : String(error),
        correlationId: CorrelationIdManager.getCurrentCorrelationId()
      });
      throw error;
    }
  }

  /**
   * Get tool definition for Nova Sonic
   */
  public getToolDefinition(toolName: string): NovaToolDefinition | undefined {
    return this.tools.get(toolName)?.definition;
  }

  /**
   * Get tool metadata
   */
  public getToolMetadata(toolName: string): VoiceToolMetadata | undefined {
    return this.tools.get(toolName)?.metadata;
  }

  /**
   * Get all tool definitions for Nova Sonic configuration
   */
  public getAllToolDefinitions(): NovaToolDefinition[] {
    return Array.from(this.tools.values()).map(reg => reg.definition);
  }

  /**
   * Get tools by category
   */
  public getToolsByCategory(category: ToolCategory): NovaToolDefinition[] {
    const toolNames = this.toolsByCategory.get(category) || new Set();
    return Array.from(toolNames)
      .map(name => this.tools.get(name)?.definition)
      .filter((def): def is NovaToolDefinition => def !== undefined);
  }

  /**
   * Get tools for specific agent
   */
  public getToolsForAgent(agentId: string): NovaToolDefinition[] {
    const toolNames = this.toolsByAgent.get(agentId) || new Set();
    return Array.from(toolNames)
      .map(name => this.tools.get(name)?.definition)
      .filter((def): def is NovaToolDefinition => def !== undefined);
  }

  /**
   * Get voice-optimized tools (fast execution)
   */
  public getVoiceOptimizedTools(): NovaToolDefinition[] {
    return Array.from(this.tools.values())
      .filter(reg => reg.metadata.supportsRealTime && reg.metadata.expectedExecutionTime < 5000)
      .map(reg => reg.definition);
  }

  /**
   * Search tools by description or example phrases
   */
  public searchTools(query: string): NovaToolDefinition[] {
    const lowerQuery = query.toLowerCase();
    
    return Array.from(this.tools.values())
      .filter(reg => {
        const description = reg.definition.toolSpec.description.toLowerCase();
        const voiceDescription = reg.metadata.voiceDescription.toLowerCase();
        const examples = reg.metadata.examplePhrases.join(' ').toLowerCase();
        
        return description.includes(lowerQuery) || 
               voiceDescription.includes(lowerQuery) || 
               examples.includes(lowerQuery);
      })
      .map(reg => reg.definition);
  }

  /**
   * Validate tool registration
   */
  private validateToolRegistration(toolName: string, registration: ToolRegistration): void {
    if (!toolName || typeof toolName !== 'string') {
      throw new Error('Tool name must be a non-empty string');
    }

    if (!registration.definition?.toolSpec?.name) {
      throw new Error('Tool definition must include toolSpec.name');
    }

    if (registration.definition.toolSpec.name !== toolName) {
      throw new Error('Tool name must match toolSpec.name');
    }

    if (!registration.definition.toolSpec.description) {
      throw new Error('Tool definition must include description');
    }

    if (!registration.metadata?.voiceDescription) {
      throw new Error('Tool metadata must include voiceDescription');
    }

    if (!Array.isArray(registration.metadata.examplePhrases)) {
      throw new Error('Tool metadata must include examplePhrases array');
    }
  }

  /**
   * Initialize default tools for common voice interactions
   */
  private initializeDefaultTools(): void {
    // Weather tool - Enhanced version
    this.registerTool('get_weather', {
      definition: {
        toolSpec: {
          name: 'get_weather',
          description: 'Get current weather conditions, temperature, and forecast for any location worldwide',
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
                description: 'Include today\'s forecast information (true/false)',
                enum: ['true', 'false']
              }
            },
            required: ['location']
          }
        }
      },
      metadata: {
        expectedExecutionTime: 3000, // Increased for more comprehensive data
        supportsRealTime: true,
        voiceDescription: 'Get current weather conditions, temperature, and forecast for any location worldwide',
        examplePhrases: [
          'What\'s the weather like in New York?',
          'How\'s the weather today?',
          'Is it raining in Seattle?',
          'What\'s the temperature in London?',
          'Weather forecast for San Francisco',
          'Current conditions in Miami',
          'Will it rain today in Chicago?',
          'Temperature in Tokyo right now',
          'Weather in Paris, France',
          'How cold is it in Alaska?'
        ],
        category: ToolCategory.INFORMATION
      }
    });

    // Time tool
    this.registerTool('get_time', {
      definition: {
        toolSpec: {
          name: 'get_time',
          description: 'Get current time for a specified timezone or location',
          inputSchema: {
            type: 'object',
            properties: {
              timezone: {
                type: 'string',
                description: 'Timezone identifier (e.g., America/New_York) or city name'
              },
              format: {
                type: 'string',
                description: 'Time format preference',
                enum: ['12hour', '24hour']
              }
            },
            required: ['timezone']
          }
        }
      },
      metadata: {
        expectedExecutionTime: 500,
        supportsRealTime: true,
        voiceDescription: 'Get the current time in any timezone or location',
        examplePhrases: [
          'What time is it?',
          'What time is it in Tokyo?',
          'Current time in London please',
          'Time in Pacific timezone'
        ],
        category: ToolCategory.INFORMATION
      }
    });

    // Web search tool
    this.registerTool('search_web', {
      definition: {
        toolSpec: {
          name: 'search_web',
          description: 'Search the web for current information on any topic',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query or question'
              },
              max_results: {
                type: 'string',
                description: 'Maximum number of results to return (1-10)',
                enum: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']
              }
            },
            required: ['query']
          }
        }
      },
      metadata: {
        expectedExecutionTime: 3000,
        supportsRealTime: true,
        voiceDescription: 'Search the internet for current information and news',
        examplePhrases: [
          'Search for the latest news about AI',
          'Look up information about quantum computing',
          'Find recent articles about climate change',
          'Search for restaurant reviews nearby'
        ],
        category: ToolCategory.INFORMATION
      }
    });

    logger.info('Default tools initialized', {
      totalTools: this.tools.size,
      categories: Array.from(this.toolsByCategory.keys()),
      correlationId: CorrelationIdManager.getCurrentCorrelationId()
    });
  }

  /**
   * Get registry statistics
   */
  public getStats() {
    const voiceOptimizedCount = Array.from(this.tools.values())
      .filter(reg => reg.metadata.supportsRealTime).length;

    return {
      totalTools: this.tools.size,
      voiceOptimizedTools: voiceOptimizedCount,
      categories: Array.from(this.toolsByCategory.keys()),
      toolsByCategory: Object.fromEntries(
        Array.from(this.toolsByCategory.entries()).map(([cat, tools]) => [cat, tools.size])
      ),
      agentsWithTools: this.toolsByAgent.size
    };
  }

  /**
   * Clear all tools (for testing)
   */
  public clear(): void {
    this.tools.clear();
    this.toolsByCategory.clear();
    this.toolsByAgent.clear();
  }
}

// Export singleton instance
export const toolRegistry = ToolRegistry.getInstance();