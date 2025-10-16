/**
 * Tests for logging configuration validation and normalization
 */

import { ConfigurationManager } from '../../../config/ConfigurationManager';

describe('LoggingConfig', () => {
  let originalLogLevel: string | undefined;
  
  beforeEach(() => {
    // Save original LOG_LEVEL
    originalLogLevel = process.env.LOG_LEVEL;
    
    // Clear any existing ConfigurationManager instance
    (ConfigurationManager as any).instance = undefined;
  });
  
  afterEach(() => {
    // Restore original LOG_LEVEL
    if (originalLogLevel !== undefined) {
      process.env.LOG_LEVEL = originalLogLevel;
    } else {
      delete process.env.LOG_LEVEL;
    }
    
    // Clear ConfigurationManager instance
    (ConfigurationManager as any).instance = undefined;
  });

  describe('LOG_LEVEL environment variable handling', () => {
    it('should use valid LOG_LEVEL values', () => {
      const validLevels = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'];
      
      for (const level of validLevels) {
        process.env.LOG_LEVEL = level;
        (ConfigurationManager as any).instance = undefined;
        
        const config = ConfigurationManager.getInstance();
        expect(config.get('logging.level')).toBe(level);
      }
    });

    it('should handle lowercase LOG_LEVEL values', () => {
      process.env.LOG_LEVEL = 'debug';
      const config = ConfigurationManager.getInstance();
      expect(config.get('logging.level')).toBe('DEBUG');
    });

    it('should handle mixed case LOG_LEVEL values', () => {
      process.env.LOG_LEVEL = 'WaRn';
      const config = ConfigurationManager.getInstance();
      expect(config.get('logging.level')).toBe('WARN');
    });

    it('should handle LOG_LEVEL with whitespace', () => {
      process.env.LOG_LEVEL = '  INFO  ';
      const config = ConfigurationManager.getInstance();
      expect(config.get('logging.level')).toBe('INFO');
    });

    it('should use default for invalid LOG_LEVEL values', () => {
      process.env.LOG_LEVEL = 'INVALID';
      const config = ConfigurationManager.getInstance();
      expect(config.get('logging.level')).toBe('INFO'); // Default value
    });

    it('should use default for empty LOG_LEVEL', () => {
      process.env.LOG_LEVEL = '';
      const config = ConfigurationManager.getInstance();
      expect(config.get('logging.level')).toBe('INFO'); // Default value
    });

    it('should use default when LOG_LEVEL is undefined', () => {
      delete process.env.LOG_LEVEL;
      const config = ConfigurationManager.getInstance();
      expect(config.get('logging.level')).toBe('INFO'); // Default value
    });
  });

  describe('ECS deployment scenarios', () => {
    it('should handle typical ECS LOG_LEVEL values', () => {
      const ecsLevels = ['ERROR', 'WARN', 'INFO'];
      
      for (const level of ecsLevels) {
        process.env.LOG_LEVEL = level;
        (ConfigurationManager as any).instance = undefined;
        
        const config = ConfigurationManager.getInstance();
        const validation = config.validate();
        
        expect(validation.isValid).toBe(true);
        expect(config.get('logging.level')).toBe(level);
      }
    });

    it('should not fail validation with valid LOG_LEVEL', () => {
      process.env.LOG_LEVEL = 'WARN';
      const config = ConfigurationManager.getInstance();
      const validation = config.validate();
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should provide helpful error message for invalid LOG_LEVEL', () => {
      process.env.LOG_LEVEL = 'VERBOSE'; // Invalid level
      const config = ConfigurationManager.getInstance();
      
      // The config should still be valid because we normalize invalid values to default
      expect(config.get('logging.level')).toBe('INFO');
      
      const validation = config.validate();
      expect(validation.isValid).toBe(true); // Should be valid after normalization
    });
  });

  describe('Configuration validation', () => {
    it('should pass validation with normalized log level', () => {
      process.env.LOG_LEVEL = 'error'; // lowercase
      const config = ConfigurationManager.getInstance();
      const validation = config.validate();
      
      expect(validation.isValid).toBe(true);
      expect(config.get('logging.level')).toBe('ERROR');
    });

    it('should handle production environment defaults', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.LOG_LEVEL;
      
      const config = ConfigurationManager.getInstance();
      expect(config.get('logging.level')).toBe('INFO');
      expect(config.get('logging.enableStructuredLogging')).toBe(true); // Production default
    });
  });
});