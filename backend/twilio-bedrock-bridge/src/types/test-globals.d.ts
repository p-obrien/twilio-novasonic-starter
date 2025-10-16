/**
 * Global test utility types
 */

declare global {
  function createTestBuffer(size: number, pattern?: number): Buffer;
  function createMuLawTestBuffer(size: number): Buffer;
  function createPcm16TestBuffer(samples: number): Buffer;
  function createMockWebSocket(): any;
}

export {};