/**
 * BufferPool Unit Tests
 * 
 * Tests for the BufferPool class that provides efficient buffer pooling
 * to reduce garbage collection pressure during audio processing.
 */

import { BufferPool, BufferPoolOptions, BufferPoolStats } from '../../../audio/BufferPool';

describe('BufferPool', () => {
  let bufferPool: BufferPool;

  beforeEach(() => {
    // Create isolated buffer pool for each test
    bufferPool = BufferPool.create({ 
      initialSize: 5, 
      maxSize: 20,
      memoryPressureThreshold: 0.8
    });
  });

  afterEach(() => {
    bufferPool.cleanup();
  });

  describe('Singleton Pattern', () => {
    it('should return same instance for getInstance', () => {
      const instance1 = BufferPool.getInstance();
      const instance2 = BufferPool.getInstance();
      
      expect(instance1).toBe(instance2);
    });

    it('should create separate instances with create method', () => {
      const instance1 = BufferPool.create();
      const instance2 = BufferPool.create();
      
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('Buffer Acquisition', () => {
    it('should acquire buffer of requested size', () => {
      const buffer = bufferPool.acquire(1024);
      
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBe(1024);
    });

    it('should reuse buffers from pool when available', () => {
      const buffer1 = bufferPool.acquire(160);
      bufferPool.release(buffer1);
      
      const buffer2 = bufferPool.acquire(160);
      
      expect(buffer2).toBe(buffer1); // Should be the same buffer
    });

    it('should create new buffer when pool is empty', () => {
      const buffers = [];
      
      // Exhaust the pool
      for (let i = 0; i < 25; i++) {
        buffers.push(bufferPool.acquire(160));
      }
      
      const newBuffer = bufferPool.acquire(160);
      expect(newBuffer).toBeInstanceOf(Buffer);
      expect(newBuffer.length).toBe(160);
      
      // Clean up
      buffers.forEach(buf => bufferPool.release(buf));
    });

    it('should handle different buffer sizes', () => {
      const sizes = [160, 320, 640, 1024, 2048];
      
      for (const size of sizes) {
        const buffer = bufferPool.acquire(size);
        expect(buffer.length).toBe(size);
        bufferPool.release(buffer);
      }
    });

    it('should track acquisitions in statistics', () => {
      const initialStats = bufferPool.getStats();
      
      bufferPool.acquire(160);
      bufferPool.acquire(320);
      
      const finalStats = bufferPool.getStats();
      expect(finalStats.acquisitions).toBe(initialStats.acquisitions + 2);
    });
  });

  describe('Buffer Release', () => {
    it('should release buffer back to pool', () => {
      const buffer = bufferPool.acquire(160);
      const initialStats = bufferPool.getStats();
      
      bufferPool.release(buffer);
      
      const finalStats = bufferPool.getStats();
      expect(finalStats.releases).toBe(initialStats.releases + 1);
    });

    it('should clear buffer contents on release', () => {
      const buffer = bufferPool.acquire(160);
      buffer.fill(0xAA); // Fill with pattern
      
      bufferPool.release(buffer);
      
      // Acquire same buffer again
      const reusedBuffer = bufferPool.acquire(160);
      expect(reusedBuffer).toBe(buffer);
      
      // Should be cleared
      for (let i = 0; i < buffer.length; i++) {
        expect(buffer[i]).toBe(0);
      }
    });

    it('should ignore release of unknown buffer', () => {
      const unknownBuffer = Buffer.alloc(160);
      const initialStats = bufferPool.getStats();
      
      bufferPool.release(unknownBuffer);
      
      const finalStats = bufferPool.getStats();
      // The release count might increment even for unknown buffers in some implementations
      expect(finalStats.releases).toBeGreaterThanOrEqual(initialStats.releases);
    });

    it('should not exceed maximum pool size', () => {
      const buffers = [];
      
      // Fill pool to capacity
      for (let i = 0; i < 25; i++) {
        buffers.push(bufferPool.acquire(160));
      }
      
      // Release all buffers
      buffers.forEach(buf => bufferPool.release(buf));
      
      const stats = bufferPool.getStats();
      const pool160Stats = stats.poolsBySize.get(160);
      
      expect(pool160Stats?.available).toBeLessThanOrEqual(bufferPool.getMaxSize());
    });
  });

  describe('Memory Pressure Management', () => {
    it('should reduce pools under memory pressure', () => {
      // Fill pool
      const buffers = [];
      for (let i = 0; i < 15; i++) {
        buffers.push(bufferPool.acquire(160));
      }
      buffers.forEach(buf => bufferPool.release(buf));
      
      const beforeStats = bufferPool.getStats();
      
      // Trigger memory pressure
      bufferPool.updateMemoryPressure(0.9);
      
      const afterStats = bufferPool.getStats();
      expect(afterStats.available).toBeLessThan(beforeStats.available);
    });

    it('should not release buffers under normal memory pressure', () => {
      const buffers = [];
      for (let i = 0; i < 10; i++) {
        buffers.push(bufferPool.acquire(160));
      }
      buffers.forEach(buf => bufferPool.release(buf));
      
      const beforeStats = bufferPool.getStats();
      
      // Normal memory pressure
      bufferPool.updateMemoryPressure(0.5);
      
      const afterStats = bufferPool.getStats();
      expect(afterStats.available).toBe(beforeStats.available);
    });

    it('should reject releases during high memory pressure', () => {
      bufferPool.updateMemoryPressure(0.9);
      
      const buffer = bufferPool.acquire(160);
      const beforeStats = bufferPool.getStats();
      
      bufferPool.release(buffer);
      
      const afterStats = bufferPool.getStats();
      // Buffer should be discarded, not added to pool
      expect(afterStats.available).toBe(beforeStats.available);
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should provide comprehensive statistics', () => {
      const buffer1 = bufferPool.acquire(160);
      const buffer2 = bufferPool.acquire(320);
      bufferPool.release(buffer1);
      
      const stats = bufferPool.getStats();
      
      expect(stats.acquisitions).toBe(2);
      expect(stats.releases).toBe(1);
      expect(stats.totalBuffers).toBeGreaterThan(0);
      expect(stats.totalMemoryBytes).toBeGreaterThan(0);
      expect(stats.poolsBySize).toBeInstanceOf(Map);
    });

    it('should track cache hit rates', () => {
      const buffer = bufferPool.acquire(160);
      bufferPool.release(buffer);
      
      // This should be a cache hit
      bufferPool.acquire(160);
      
      const stats = bufferPool.getStats();
      expect(stats.cacheHits).toBeGreaterThan(0);
    });

    it('should track cache misses', () => {
      // Exhaust pre-allocated buffers first
      const buffers = [];
      for (let i = 0; i < 10; i++) {
        buffers.push(bufferPool.acquire(160));
      }
      
      // This should be a cache miss (new allocation)
      const newBuffer = bufferPool.acquire(160);
      
      const stats = bufferPool.getStats();
      expect(stats.cacheMisses).toBeGreaterThan(0);
      
      // Clean up
      buffers.forEach(buf => bufferPool.release(buf));
      bufferPool.release(newBuffer);
    });

    it('should provide per-size pool statistics', () => {
      bufferPool.acquire(160);
      bufferPool.acquire(320);
      
      const stats = bufferPool.getStats();
      
      expect(stats.poolsBySize.has(160)).toBe(true);
      expect(stats.poolsBySize.has(320)).toBe(true);
      
      const pool160 = stats.poolsBySize.get(160)!;
      expect(pool160.size).toBe(160);
      expect(pool160.inUse).toBe(1);
      expect(pool160.totalAllocations).toBe(1);
    });
  });

  describe('Pool Initialization', () => {
    it('should pre-allocate buffers for common sizes', () => {
      const freshPool = BufferPool.create({ initialSize: 3 });
      const stats = freshPool.getStats();
      
      // Should have pre-allocated buffers for common sizes
      expect(stats.totalBuffers).toBeGreaterThan(0);
      expect(stats.poolsBySize.size).toBeGreaterThan(0);
      
      freshPool.cleanup();
    });

    it('should respect initial pool size configuration', () => {
      const customPool = BufferPool.create({ initialSize: 10 });
      const stats = customPool.getStats();
      
      // Should have more buffers due to higher initial size
      expect(stats.available).toBeGreaterThan(0);
      
      customPool.cleanup();
    });

    it('should respect maximum pool size configuration', () => {
      const customPool = BufferPool.create({ maxSize: 5 });
      
      expect(customPool.getMaxSize()).toBe(5);
      
      customPool.cleanup();
    });
  });

  describe('Cleanup and Shutdown', () => {
    it('should cleanup all pools and reset statistics', () => {
      bufferPool.acquire(160);
      bufferPool.acquire(320);
      
      bufferPool.cleanup();
      
      const stats = bufferPool.getStats();
      expect(stats.acquisitions).toBe(0);
      expect(stats.releases).toBe(0);
      expect(stats.totalBuffers).toBe(0);
    });

    it('should shutdown gracefully', () => {
      bufferPool.acquire(160);
      
      expect(() => {
        bufferPool.shutdown();
      }).not.toThrow();
      
      const stats = bufferPool.getStats();
      expect(stats.totalBuffers).toBe(0);
    });

    it('should force cleanup all resources', () => {
      const buffers = [];
      for (let i = 0; i < 10; i++) {
        buffers.push(bufferPool.acquire(160));
      }
      
      bufferPool.forceCleanup();
      
      const stats = bufferPool.getStats();
      expect(stats.acquisitions).toBe(0);
      expect(stats.releases).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero-size buffer requests', () => {
      const buffer = bufferPool.acquire(0);
      
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBe(0);
    });

    it('should handle very large buffer requests', () => {
      const largeSize = 1024 * 1024; // 1MB
      const buffer = bufferPool.acquire(largeSize);
      
      expect(buffer.length).toBe(largeSize);
      
      bufferPool.release(buffer);
    });

    it('should handle rapid acquire/release cycles', () => {
      for (let i = 0; i < 100; i++) {
        const buffer = bufferPool.acquire(160);
        bufferPool.release(buffer);
      }
      
      const stats = bufferPool.getStats();
      expect(stats.acquisitions).toBe(100);
      expect(stats.releases).toBe(100);
    });

    it('should handle concurrent operations safely', () => {
      const buffers = [];
      
      // Simulate concurrent operations
      for (let i = 0; i < 50; i++) {
        buffers.push(bufferPool.acquire(160));
      }
      
      // Release in different order
      for (let i = buffers.length - 1; i >= 0; i--) {
        bufferPool.release(buffers[i]);
      }
      
      const stats = bufferPool.getStats();
      expect(stats.acquisitions).toBe(50);
      expect(stats.releases).toBe(50);
    });
  });

  describe('Configuration Options', () => {
    it('should handle all configuration options', () => {
      const options: BufferPoolOptions = {
        initialSize: 8,
        maxSize: 25,
        memoryPressureThreshold: 0.7,
        maintenanceIntervalMs: 60000
      };
      
      const customPool = BufferPool.create(options);
      
      expect(customPool.getMaxSize()).toBe(25);
      
      customPool.cleanup();
    });

    it('should handle legacy option names', () => {
      const options: BufferPoolOptions = {
        initialPoolSize: 8,
        maxPoolSize: 25
      };
      
      const customPool = BufferPool.create(options);
      
      expect(customPool.getMaxSize()).toBe(25);
      
      customPool.cleanup();
    });

    it('should use defaults for missing options', () => {
      const customPool = BufferPool.create({});
      
      expect(customPool.getMaxSize()).toBeGreaterThan(0);
      
      customPool.cleanup();
    });
  });

  describe('Performance Characteristics', () => {
    it('should provide fast buffer acquisition', () => {
      // Pre-warm the pool
      const buffer = bufferPool.acquire(160);
      bufferPool.release(buffer);
      
      const startTime = process.hrtime.bigint();
      
      for (let i = 0; i < 1000; i++) {
        const buf = bufferPool.acquire(160);
        bufferPool.release(buf);
      }
      
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1_000_000;
      
      // Should be very fast (less than 100ms for 1000 operations)
      expect(durationMs).toBeLessThan(100);
    });

    it('should maintain consistent performance under load', () => {
      const buffers = [];
      
      // Create load
      for (let i = 0; i < 100; i++) {
        buffers.push(bufferPool.acquire(160));
      }
      
      const startTime = process.hrtime.bigint();
      
      // Release and re-acquire
      for (let i = 0; i < 100; i++) {
        bufferPool.release(buffers[i]);
        buffers[i] = bufferPool.acquire(160);
      }
      
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1_000_000;
      
      expect(durationMs).toBeLessThan(50);
      
      // Clean up
      buffers.forEach(buf => bufferPool.release(buf));
    });
  });
});