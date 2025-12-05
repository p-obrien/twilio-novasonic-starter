module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  
  // Test structure - includes all test files
  testMatch: [
    '<rootDir>/src/__tests__/**/*.test.ts'
  ],
  
  // Ignore legacy and backup tests
  testPathIgnorePatterns: [
    '<rootDir>/src/__tests__/backup/',
    '<rootDir>/node_modules/',
    '<rootDir>/dist/'
  ],
  
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/utils/TestEnvironment.ts'],
  
  // Fast test execution
  testTimeout: 5000, // 5 seconds max per test
  
  // Slow test threshold reporting
  slowTestThreshold: 1000, // Report tests taking longer than 1 second
  
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
      useESM: false
    }],
  },
  
  // Module resolution with clean paths
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@tests/(.*)$': '<rootDir>/src/__tests__/$1'
  },
  
  // Comprehensive coverage configuration
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/*.spec.{ts,tsx}',
    '!src/__tests__/**/*',
    '!src/**/*.d.ts',
    '!src/**/index.ts' // Usually just exports
  ],
  
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 90,
      lines: 90,
      statements: 90
    }
  },
  
  // Performance optimizations
  maxWorkers: '50%', // Run tests in parallel using 50% of CPU cores
  cache: true,
  cacheDirectory: '<rootDir>/node_modules/.cache/jest',
  
  // Performance monitoring
  detectOpenHandles: false, // Disable for performance (enable for debugging)
  forceExit: false, // Let tests complete naturally
  
  // Parallel execution for unit tests (integration tests use --runInBand)
  maxConcurrency: 5, // Max concurrent test suites
  
  // Clean state between tests
  clearMocks: true,
  restoreMocks: true,
  resetMocks: true,
  
  // Clean output
  verbose: false,
  silent: false,
  
  // Custom reporters for performance monitoring
  reporters: [
    'default',
    ['<rootDir>/src/__tests__/utils/PerformanceReporter.ts', { slowThreshold: 1000 }]
  ],
  
  // Error handling
  errorOnDeprecated: true,
  
  // Ensure Jest globals are available without imports
  injectGlobals: true
};