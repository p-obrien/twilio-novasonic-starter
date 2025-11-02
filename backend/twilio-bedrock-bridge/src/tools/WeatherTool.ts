/**
 * @fileoverview Weather Tool Implementation
 * 
 * Provides weather information retrieval for voice conversations.
 * Integrates with weather APIs to fetch current conditions, forecasts,
 * and location-based weather data optimized for voice responses.
 */

import axios, { AxiosResponse } from 'axios';
import logger from '../observability/logger';
import { CorrelationIdManager } from '../utils/correlationId';
import { extractErrorDetails } from '../errors/ClientErrors';

/**
 * Weather tool input parameters
 */
export interface WeatherToolInput {
  location: string;
  units?: 'celsius' | 'fahrenheit';
  includeHourly?: boolean;
  includeForecast?: boolean;
}

/**
 * Weather data structure
 */
export interface WeatherData {
  location: {
    name: string;
    region?: string;
    country: string;
    coordinates?: {
      lat: number;
      lon: number;
    };
  };
  current: {
    temperature: number;
    feelsLike: number;
    condition: string;
    description: string;
    humidity: number;
    windSpeed: number;
    windDirection?: string;
    pressure?: number;
    visibility?: number;
    uvIndex?: number;
    cloudCover?: number;
  };
  forecast?: {
    today: {
      high: number;
      low: number;
      condition: string;
      chanceOfRain?: number;
    };
    tomorrow?: {
      high: number;
      low: number;
      condition: string;
      chanceOfRain?: number;
    };
  };
  hourly?: Array<{
    time: string;
    temperature: number;
    condition: string;
    chanceOfRain?: number;
  }>;
  lastUpdated: string;
}

/**
 * Weather tool result for voice output
 */
export interface WeatherToolResult {
  success: boolean;
  data?: WeatherData;
  speechText: string;
  displayText?: string;
  error?: string;
}

/**
 * Weather API configuration
 */
interface WeatherAPIConfig {
  apiKey: string;
  baseUrl: string;
  timeout: number;
}

/**
 * Weather Tool Implementation
 * 
 * Fetches weather data from external APIs and formats responses
 * for natural voice output in real-time conversations.
 */
export class WeatherTool {
  private readonly config: WeatherAPIConfig;
  private readonly cache = new Map<string, { data: WeatherData; timestamp: number }>();
  private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache

  constructor(config?: Partial<WeatherAPIConfig>) {
    this.config = {
      apiKey: config?.apiKey || process.env.WEATHER_API_KEY || '',
      baseUrl: config?.baseUrl || 'https://api.openweathermap.org/data/2.5',
      timeout: config?.timeout || 5000
    };

    if (!this.config.apiKey) {
      logger.warn('Weather API key not configured. Weather tool will use mock data.');
    }
  }

  /**
   * Execute weather tool with voice-optimized response
   */
  public async execute(input: WeatherToolInput): Promise<WeatherToolResult> {
    const startTime = Date.now();
    const correlationId = CorrelationIdManager.getCurrentCorrelationId();

    logger.info('Executing weather tool', {
      location: input.location,
      units: input.units || 'fahrenheit',
      correlationId
    });

    try {
      // Validate input
      if (!input.location || typeof input.location !== 'string') {
        throw new Error('Location is required and must be a string');
      }

      // Check cache first
      const cacheKey = this.getCacheKey(input);
      const cachedData = this.getCachedWeather(cacheKey);
      
      if (cachedData) {
        logger.debug('Using cached weather data', { location: input.location, correlationId });
        return this.formatWeatherResponse(cachedData, input, Date.now() - startTime);
      }

      // Fetch weather data
      const weatherData = await this.fetchWeatherData(input);
      
      // Cache the result
      this.cacheWeatherData(cacheKey, weatherData);

      const result = this.formatWeatherResponse(weatherData, input, Date.now() - startTime);

      logger.info('Weather tool executed successfully', {
        location: input.location,
        executionTime: Date.now() - startTime,
        correlationId
      });

      return result;

    } catch (error) {
      const executionTime = Date.now() - startTime;
      logger.error('Weather tool execution failed', {
        location: input.location,
        executionTime,
        error: extractErrorDetails(error),
        correlationId
      });

      return {
        success: false,
        speechText: this.formatErrorForVoice(error, input.location),
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Fetch weather data from API or mock service
   */
  private async fetchWeatherData(input: WeatherToolInput): Promise<WeatherData> {
    if (!this.config.apiKey) {
      return this.getMockWeatherData(input.location);
    }

    try {
      // Fetch current weather
      const currentWeatherUrl = `${this.config.baseUrl}/weather`;
      const currentParams = {
        q: input.location,
        appid: this.config.apiKey,
        units: input.units === 'celsius' ? 'metric' : 'imperial'
      };

      const currentResponse: AxiosResponse = await axios.get(currentWeatherUrl, {
        params: currentParams,
        timeout: this.config.timeout
      });

      const currentData = currentResponse.data;

      // Fetch forecast if requested
      let forecastData = null;
      if (input.includeForecast) {
        const forecastUrl = `${this.config.baseUrl}/forecast`;
        const forecastResponse: AxiosResponse = await axios.get(forecastUrl, {
          params: currentParams,
          timeout: this.config.timeout
        });
        forecastData = forecastResponse.data;
      }

      return this.parseWeatherAPIResponse(currentData, forecastData, input);

    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new Error(`Location "${input.location}" not found`);
        } else if (error.response?.status === 401) {
          throw new Error('Weather API authentication failed');
        } else if (error.code === 'ECONNABORTED') {
          throw new Error('Weather service request timed out');
        }
      }
      throw new Error(`Failed to fetch weather data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Parse OpenWeatherMap API response
   */
  private parseWeatherAPIResponse(currentData: any, forecastData: any, input: WeatherToolInput): WeatherData {
    const weatherData: WeatherData = {
      location: {
        name: currentData.name,
        country: currentData.sys?.country || 'Unknown',
        region: currentData.sys?.state,
        coordinates: {
          lat: currentData.coord?.lat,
          lon: currentData.coord?.lon
        }
      },
      current: {
        temperature: Math.round(currentData.main.temp),
        feelsLike: Math.round(currentData.main.feels_like),
        condition: currentData.weather[0]?.main || 'Unknown',
        description: currentData.weather[0]?.description || 'No description',
        humidity: currentData.main.humidity,
        windSpeed: Math.round(currentData.wind?.speed || 0),
        windDirection: this.getWindDirection(currentData.wind?.deg),
        pressure: currentData.main.pressure,
        visibility: currentData.visibility ? Math.round(currentData.visibility / 1000) : undefined,
        uvIndex: currentData.uvi,
        cloudCover: currentData.clouds?.all
      },
      lastUpdated: new Date().toISOString()
    };

    // Add forecast data if available
    if (forecastData && forecastData.list) {
      const todayForecast = forecastData.list[0];
      const tomorrowForecast = forecastData.list.find((item: any) => {
        const itemDate = new Date(item.dt * 1000);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return itemDate.getDate() === tomorrow.getDate();
      });

      weatherData.forecast = {
        today: {
          high: Math.round(todayForecast?.main.temp_max || weatherData.current.temperature),
          low: Math.round(todayForecast?.main.temp_min || weatherData.current.temperature),
          condition: todayForecast?.weather[0]?.main || weatherData.current.condition,
          chanceOfRain: todayForecast?.pop ? Math.round(todayForecast.pop * 100) : undefined
        }
      };

      if (tomorrowForecast) {
        weatherData.forecast.tomorrow = {
          high: Math.round(tomorrowForecast.main.temp_max),
          low: Math.round(tomorrowForecast.main.temp_min),
          condition: tomorrowForecast.weather[0]?.main || 'Unknown',
          chanceOfRain: tomorrowForecast.pop ? Math.round(tomorrowForecast.pop * 100) : undefined
        };
      }
    }

    return weatherData;
  }

  /**
   * Get mock weather data for testing/fallback
   */
  private getMockWeatherData(location: string): WeatherData {
    const mockConditions = ['Sunny', 'Cloudy', 'Partly Cloudy', 'Rainy', 'Clear'];
    const randomCondition = mockConditions[Math.floor(Math.random() * mockConditions.length)];
    const baseTemp = Math.floor(Math.random() * 40) + 50; // 50-90°F

    return {
      location: {
        name: location,
        country: 'US',
        region: 'Mock Region'
      },
      current: {
        temperature: baseTemp,
        feelsLike: baseTemp + Math.floor(Math.random() * 10) - 5,
        condition: randomCondition,
        description: randomCondition.toLowerCase(),
        humidity: Math.floor(Math.random() * 50) + 30,
        windSpeed: Math.floor(Math.random() * 15) + 5,
        windDirection: 'SW'
      },
      forecast: {
        today: {
          high: baseTemp + 5,
          low: baseTemp - 10,
          condition: randomCondition,
          chanceOfRain: Math.floor(Math.random() * 100)
        }
      },
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Format weather response for voice output
   */
  private formatWeatherResponse(weatherData: WeatherData, input: WeatherToolInput, executionTime: number): WeatherToolResult {
    const units = input.units === 'celsius' ? 'Celsius' : 'Fahrenheit';
    const unitsSymbol = input.units === 'celsius' ? '°C' : '°F';

    // Create voice-optimized response
    let speechText = `The weather in ${weatherData.location.name}`;
    
    if (weatherData.location.region && weatherData.location.region !== weatherData.location.name) {
      speechText += `, ${weatherData.location.region}`;
    }
    
    speechText += ` is currently ${weatherData.current.condition.toLowerCase()}`;
    speechText += ` with a temperature of ${weatherData.current.temperature} degrees ${units.toLowerCase()}.`;

    // Add feels like if significantly different
    if (Math.abs(weatherData.current.temperature - weatherData.current.feelsLike) > 3) {
      speechText += ` It feels like ${weatherData.current.feelsLike} degrees.`;
    }

    // Add additional details for comprehensive requests
    if (input.includeForecast && weatherData.forecast) {
      speechText += ` Today's high will be ${weatherData.forecast.today.high} degrees`;
      speechText += ` with a low of ${weatherData.forecast.today.low} degrees.`;
      
      if (weatherData.forecast.today.chanceOfRain && weatherData.forecast.today.chanceOfRain > 20) {
        speechText += ` There's a ${weatherData.forecast.today.chanceOfRain}% chance of rain.`;
      }
    }

    // Add wind information if significant
    if (weatherData.current.windSpeed > 10) {
      speechText += ` Winds are ${weatherData.current.windSpeed} miles per hour`;
      if (weatherData.current.windDirection) {
        speechText += ` from the ${weatherData.current.windDirection}`;
      }
      speechText += '.';
    }

    // Create display text with more details
    const displayText = this.formatDisplayText(weatherData, units, unitsSymbol);

    return {
      success: true,
      data: weatherData,
      speechText,
      displayText
    };
  }

  /**
   * Format detailed display text
   */
  private formatDisplayText(weatherData: WeatherData, units: string, unitsSymbol: string): string {
    let displayText = `Weather for ${weatherData.location.name}`;
    
    if (weatherData.location.region) {
      displayText += `, ${weatherData.location.region}`;
    }
    displayText += `:\n\n`;

    displayText += `Current: ${weatherData.current.temperature}${unitsSymbol} (feels like ${weatherData.current.feelsLike}${unitsSymbol})\n`;
    displayText += `Condition: ${weatherData.current.condition}\n`;
    displayText += `Humidity: ${weatherData.current.humidity}%\n`;
    displayText += `Wind: ${weatherData.current.windSpeed} mph`;
    
    if (weatherData.current.windDirection) {
      displayText += ` ${weatherData.current.windDirection}`;
    }
    displayText += '\n';

    if (weatherData.forecast) {
      displayText += `\nToday: High ${weatherData.forecast.today.high}${unitsSymbol}, Low ${weatherData.forecast.today.low}${unitsSymbol}`;
      if (weatherData.forecast.today.chanceOfRain) {
        displayText += `, ${weatherData.forecast.today.chanceOfRain}% chance of rain`;
      }
    }

    return displayText;
  }

  /**
   * Format error messages for voice output
   */
  private formatErrorForVoice(error: unknown, location: string): string {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('not found')) {
      return `I couldn't find weather information for ${location}. Please try a different location or be more specific.`;
    }

    if (errorMessage.includes('timeout')) {
      return `The weather service is taking too long to respond. Please try again in a moment.`;
    }

    if (errorMessage.includes('authentication')) {
      return `I'm having trouble accessing the weather service right now. Please try again later.`;
    }

    return `I'm sorry, I couldn't get the weather information for ${location} right now. Please try again.`;
  }

  /**
   * Get wind direction from degrees
   */
  private getWindDirection(degrees?: number): string | undefined {
    if (degrees === undefined) return undefined;

    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(degrees / 22.5) % 16;
    return directions[index];
  }

  /**
   * Generate cache key for weather data
   */
  private getCacheKey(input: WeatherToolInput): string {
    return `weather:${input.location.toLowerCase()}:${input.units || 'fahrenheit'}`;
  }

  /**
   * Get cached weather data if still valid
   */
  private getCachedWeather(cacheKey: string): WeatherData | null {
    const cached = this.cache.get(cacheKey);
    if (!cached) return null;

    const isExpired = Date.now() - cached.timestamp > this.CACHE_TTL_MS;
    if (isExpired) {
      this.cache.delete(cacheKey);
      return null;
    }

    return cached.data;
  }

  /**
   * Cache weather data
   */
  private cacheWeatherData(cacheKey: string, data: WeatherData): void {
    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now()
    });

    // Clean up old cache entries periodically
    if (this.cache.size > 100) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
  }

  /**
   * Clear weather cache
   */
  public clearCache(): void {
    this.cache.clear();
    logger.debug('Weather tool cache cleared');
  }

  /**
   * Get cache statistics
   */
  public getCacheStats() {
    return {
      size: this.cache.size,
      ttlMs: this.CACHE_TTL_MS
    };
  }
}

// Export singleton instance
export const weatherTool = new WeatherTool();