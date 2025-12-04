/**
 * Mock logger for testing
 */

const logger = {
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn()
};

export default logger;
