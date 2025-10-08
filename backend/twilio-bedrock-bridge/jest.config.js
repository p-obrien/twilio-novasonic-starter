module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  
  // Clean test structure - only new tests
  testMatch: [
    '<rootDir>/src/__tests__/unit/**/*.test.ts',
    '<rootDir>/src/__tests__/integration/**/*.test.ts'
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
  maxWorkers: '50%',
  cache: true,
  cacheDirectory: '<rootDir>/node_modules/.cache/jest',
  
  // Clean state between tests
  clearMocks: true,
  restoreMocks: true,
  resetMocks: true,
  
  // Clean output
  verbose: false,
  silent: false,
  
  // Error handling
  errorOnDeprecated: true,
  
  // Ensure Jest globals are available without imports
  injectGlobals: true
};