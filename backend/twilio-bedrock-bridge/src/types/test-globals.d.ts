/**
 * Global test utility types and Jest globals
 */

/// <reference types="jest" />

declare global {
  function createTestBuffer(size: number, pattern?: number): Buffer;
  function createMuLawTestBuffer(size: number): Buffer;
  function createPcm16TestBuffer(samples: number): Buffer;
  function createMockWebSocket(): any;
}

export {};