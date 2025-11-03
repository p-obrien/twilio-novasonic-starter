/**
 * Logger utility - re-exports the main logger from observability
 * This provides a convenient import path for tests and other modules
 */
export { default as logger, isLevelEnabled, LogLevel, clearTraceContextCache } from '../observability/logger';
export { default } from '../observability/logger';