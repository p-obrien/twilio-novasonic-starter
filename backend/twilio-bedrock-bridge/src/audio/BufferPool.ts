/**
 * BufferPool - High-performance buffer pooling system for audio processing
 * 
 * This class implements an efficient buffer pooling mechanism to reduce garbage
 * collection pressure during intensive audio processing operations. It maintains
 * pools of pre-allocated buffers in different sizes to minimize allocation overhead.
 * 
 * Key features:
 * - Multiple size pools for different buffer requirements
 * - Memory pressure monitoring with adaptive sizing
 * - Automatic pool expansion and contraction based on usage
 * - Zero-copy buffer reuse to minimize GC pressure
 * - Thread-safe operations for concurrent audio sessions
 * 
 * The pool automatically manages buffer lifecycle and provides metrics for
 * monitoring memory usage and pool effectiveness.
 * 
 * @example
 * ```typescript
 * const pool = BufferPool.getInstance();
 * const buffer = pool.acquire(1024); // Get 1KB buffer
 * // ... use buffer for audio processing
 * pool.release(buffer); // Return to pool for reuse
 * ```
 */

import logger from '../observability/logger';

/**
 * Configuration options for buffer pool behavior
 */
export interface BufferPoolOptions {
  /** Initial number of buffers to pre-allocate per size */
  initialPoolSize?: number;
  /** Initial size for buffer pool (alias for initialPoolSize) */
  initialSize?: number;
  /** Maximum number of buffers to keep in each pool */
  maxPoolSize?: number;
  /** Maximum size for buffer pool (alias for maxPoolSize) */
  maxSize?: number;
  /** Buffer size in bytes for individual buffers */
  bufferSize?: number;
  /** Memory pressure threshold (0.0-1.0) to trigger pool reduction */
  memoryPressureThreshold?: number;
  /** Interval in milliseconds for pool maintenance operations */
  maintenanceIntervalMs?: number;
}

/**
 * Statistics about buffer pool usage and performance
 */
export interface BufferPoolStats {
  /** Total number of buffers across all pools */
  totalBuffers: number;
  /** Total memory allocated by pools in bytes */
  totalMemoryBytes: number;
  /** Number of successful buffer acquisitions */
  acquisitions: number;
  /** Number of buffer releases back to pool */
  releases: number;
  /** Number of cache hits (reused buffers) */
  cacheHits: number;
  /** Number of cache misses (new allocations) */
  cacheMisses: number;
  /** Current memory pressure level (0.0-1.0) */
  memoryPressure: number;
  /** Pool statistics by buffer size */
  poolsBySize: Map<number, PoolSizeStats>;
  
  // Additional properties required by tests
  /** Current pool size (total buffers) */
  size: number;
  /** Maximum pool size configured */
  maxSize: number;
  /** Number of available buffers ready for use */
  available: number;
  /** Number of allocated buffers currently in use */
  allocated: number;
  /** Number of recycled buffers (same as releases) */
  recycled: number;
  /** Total allocations across all pools (same as acquisitions) */
  totalAllocations: number;
  /** Total recycles across all pools (same as releases) */
  totalRecycles: number;
}

/**
 * Statistics for a specific buffer size pool
 */
export interface PoolSizeStats {
  /** Buffer size in bytes */
  size: number;
  /** Number of available buffers in pool */
  available: number;
  /** Number of buffers currently in use */
  inUse: number;
  /** Total allocations for this size */
  totalAllocations: number;
  /** Cache hit rate for this size */
  hitRate: number;
}

/**
 * Internal pool data for a specific buffer size
 */
interface BufferSizePool {
  /** Available buffers ready for reuse */
  available: Buffer[];
  /** Buffers currently in use (for tracking) */
  inUse: Set<Buffer>;
  /** Total number of allocations for this size */
  totalAllocations: number;
  /** Number of cache hits for this size */
  cacheHits: number;
  /** Last access time for pool maintenance */
  lastAccess: number;
}

/**
 * Singleton buffer pool for efficient memory management across audio processing
 */
export class BufferPool {
  /** Singleton instance */
  private static instance: BufferPool;

  /** Pools organized by buffer size */
  private pools: Map<number, BufferSizePool> = new Map();

  /** Configuration options */
  private options: Required<BufferPoolOptions>;

  /** Global statistics */
  private stats = {
    acquisitions: 0,
    releases: 0,
    cacheHits: 0,
    cacheMisses: 0
  };

  /** Memory monitoring */
  private memoryPressure = 0;
  private maintenanceTimer: NodeJS.Timeout | null = null;

  /** Common buffer sizes for audio processing */
  private readonly COMMON_SIZES = [
    160,    // μ-law frame (20ms at 8kHz)
    320,    // PCM16LE frame (20ms at 8kHz)
    640,    // PCM16LE frame (20ms at 16kHz)
    1024,   // 1KB general purpose
    2048,   // 2KB for larger chunks
    4096,   // 4KB for processing buffers
    8192,   // 8KB for streaming
    16384   // 16KB for large operations
  ];

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor(options: BufferPoolOptions = {}) {
    this.options = {
      initialPoolSize: options.initialPoolSize ?? options.initialSize ?? 10,
      maxPoolSize: options.maxPoolSize ?? options.maxSize ?? 50,
      memoryPressureThreshold: options.memoryPressureThreshold ?? 0.8,
      maintenanceIntervalMs: options.maintenanceIntervalMs ?? 30000
    } as Required<BufferPoolOptions>;

    this.initializePools();
    this.startMaintenance();

    logger.info('BufferPool initialized', {
      initialPoolSize: this.options.initialPoolSize,
      maxPoolSize: this.options.maxPoolSize,
      commonSizes: this.COMMON_SIZES
    });
  }

  /**
   * Gets the singleton instance of BufferPool
   */
  public static getInstance(options?: BufferPoolOptions): BufferPool {
    if (!BufferPool.instance) {
      BufferPool.instance = new BufferPool(options);
    }
    return BufferPool.instance;
  }

  /**
   * Creates a new BufferPool instance for testing purposes
   * This factory method allows tests to create isolated instances
   */
  public static create(options?: BufferPoolOptions): BufferPool {
    return new BufferPool(options);
  }

  /**
   * Initializes pools for common buffer sizes
   */
  private initializePools(): void {
    for (const size of this.COMMON_SIZES) {
      this.createPool(size);
    }
  }

  /**
   * Creates a new pool for a specific buffer size
   */
  private createPool(size: number): BufferSizePool {
    const pool: BufferSizePool = {
      available: [],
      inUse: new Set(),
      totalAllocations: 0,
      cacheHits: 0,
      lastAccess: Date.now()
    };

    // Pre-allocate initial buffers
    for (let i = 0; i < this.options.initialPoolSize; i++) {
      pool.available.push(Buffer.allocUnsafe(size));
    }

    this.pools.set(size, pool);
    
    logger.debug('Created buffer pool', { 
      size, 
      initialBuffers: this.options.initialPoolSize 
    });

    return pool;
  }

  /**
   * Acquires a buffer of the specified size from the pool
   */
  public acquire(size: number): Buffer {
    this.stats.acquisitions++;

    // Get or create pool for this size
    let pool = this.pools.get(size);
    if (!pool) {
      pool = this.createPool(size);
    }

    pool.lastAccess = Date.now();
    pool.totalAllocations++;

    // Try to reuse an existing buffer
    if (pool.available.length > 0) {
      const buffer = pool.available.pop()!;
      pool.inUse.add(buffer);
      pool.cacheHits++;
      this.stats.cacheHits++;

      logger.debug('Buffer acquired from pool', { 
        size, 
        available: pool.available.length,
        inUse: pool.inUse.size
      });

      return buffer;
    }

    // No available buffer, allocate new one
    const buffer = Buffer.allocUnsafe(size);
    pool.inUse.add(buffer);
    this.stats.cacheMisses++;

    logger.debug('New buffer allocated', { 
      size, 
      available: pool.available.length,
      inUse: pool.inUse.size
    });

    return buffer;
  }

  /**
   * Releases a buffer back to the pool for reuse
   */
  public release(buffer: Buffer): void {
    this.stats.releases++;

    const size = buffer.length;
    const pool = this.pools.get(size);

    if (!pool || !pool.inUse.has(buffer)) {
      logger.warn('Attempted to release unknown buffer', { size });
      return;
    }

    // Remove from in-use tracking
    pool.inUse.delete(buffer);

    // Check if pool is at capacity
    if (pool.available.length >= this.options.maxPoolSize) {
      logger.debug('Pool at capacity, discarding buffer', { 
        size, 
        poolSize: pool.available.length 
      });
      return;
    }

    // Check memory pressure
    if (this.memoryPressure > this.options.memoryPressureThreshold) {
      logger.debug('High memory pressure, discarding buffer', { 
        size, 
        memoryPressure: this.memoryPressure 
      });
      return;
    }

    // Clear buffer contents for security
    buffer.fill(0);

    // Return to pool
    pool.available.push(buffer);

    logger.debug('Buffer released to pool', { 
      size, 
      available: pool.available.length,
      inUse: pool.inUse.size
    });
  }

  /**
   * Gets current buffer pool statistics
   */
  public getStats(): BufferPoolStats {
    const poolsBySize = new Map<number, PoolSizeStats>();
    let totalBuffers = 0;
    let totalMemoryBytes = 0;
    let totalAvailable = 0;
    let totalAllocated = 0;

    for (const [size, pool] of this.pools) {
      const available = pool.available.length;
      const inUse = pool.inUse.size;
      const total = available + inUse;
      
      totalBuffers += total;
      totalMemoryBytes += total * size;
      totalAvailable += available;
      totalAllocated += inUse;

      poolsBySize.set(size, {
        size,
        available,
        inUse,
        totalAllocations: pool.totalAllocations,
        hitRate: pool.totalAllocations > 0 ? pool.cacheHits / pool.totalAllocations : 0
      });
    }

    return {
      totalBuffers,
      totalMemoryBytes,
      acquisitions: this.stats.acquisitions,
      releases: this.stats.releases,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      memoryPressure: this.memoryPressure,
      poolsBySize,
      
      // Additional properties required by tests
      size: totalBuffers,
      maxSize: this.options.maxPoolSize * this.pools.size, // Max size across all pools
      available: totalAvailable,
      allocated: totalAllocated,
      recycled: this.stats.releases,
      totalAllocations: this.stats.acquisitions,
      totalRecycles: this.stats.releases
    };
  }

  /**
   * Gets the maximum pool size configuration
   */
  public getMaxSize(): number {
    return this.options.maxPoolSize;
  }

  /**
   * Cleans up resources and resets the pool
   * This method is useful for testing and resource management
   */
  public cleanup(): void {
    // Clear all pools
    for (const pool of this.pools.values()) {
      pool.available.length = 0;
      pool.inUse.clear();
    }
    
    // Reset statistics
    this.stats = {
      acquisitions: 0,
      releases: 0,
      cacheHits: 0,
      cacheMisses: 0
    };

    // Reset memory pressure
    this.memoryPressure = 0;

    logger.debug('BufferPool cleaned up', {
      poolsCleared: this.pools.size
    });
  }

  /**
   * Updates memory pressure level based on system memory usage
   */
  public updateMemoryPressure(pressure: number): void {
    this.memoryPressure = Math.max(0, Math.min(1, pressure));
    
    if (this.memoryPressure > this.options.memoryPressureThreshold) {
      logger.warn('High memory pressure detected', { 
        pressure: this.memoryPressure,
        threshold: this.options.memoryPressureThreshold
      });
      this.reducePools();
    }
  }

  /**
   * Reduces pool sizes during high memory pressure
   */
  private reducePools(): void {
    let totalReduced = 0;

    for (const [size, pool] of this.pools) {
      const targetSize = Math.floor(pool.available.length * 0.5);
      const toRemove = pool.available.length - targetSize;
      
      if (toRemove > 0) {
        pool.available.splice(0, toRemove);
        totalReduced += toRemove;
      }
    }

    if (totalReduced > 0) {
      logger.info('Reduced buffer pools due to memory pressure', { 
        buffersRemoved: totalReduced,
        memoryPressure: this.memoryPressure
      });
    }
  }

  /**
   * Starts periodic maintenance operations
   * During tests we avoid starting background timers to prevent async work
   * after Jest teardown which can cause "Cannot log after tests are done".
   */
  private startMaintenance(): void {
    if (process.env.NODE_ENV === 'test') {
      // Skip starting maintenance timer in test environment
      return;
    }
    this.maintenanceTimer = setInterval(() => {
      this.performMaintenance();
    }, this.options.maintenanceIntervalMs);
    // Allow Node to exit even if timer is running (defensive)
    if (this.maintenanceTimer && typeof (this.maintenanceTimer as any).unref === 'function') {
      try { (this.maintenanceTimer as any).unref(); } catch (e) { /* ignore */ }
    }
  }

  /**
   * Performs periodic pool maintenance
   */
  private performMaintenance(): void {
    const now = Date.now();
    const maxIdleTime = 5 * 60 * 1000; // 5 minutes
    let poolsRemoved = 0;
    let buffersRemoved = 0;

    // Remove unused pools and reduce oversized pools
    for (const [size, pool] of this.pools) {
      const idleTime = now - pool.lastAccess;

      // Remove completely unused pools
      if (pool.inUse.size === 0 && pool.available.length === 0 && idleTime > maxIdleTime) {
        if (!this.COMMON_SIZES.includes(size)) {
          this.pools.delete(size);
          poolsRemoved++;
          continue;
        }
      }

      // Reduce oversized pools
      const targetSize = this.options.initialPoolSize;
      if (pool.available.length > targetSize) {
        const excess = pool.available.length - targetSize;
        pool.available.splice(0, excess);
        buffersRemoved += excess;
      }
    }

    if (poolsRemoved > 0 || buffersRemoved > 0) {
      logger.debug('Pool maintenance completed', { 
        poolsRemoved, 
        buffersRemoved,
        totalPools: this.pools.size
      });
    }
  }

  /**
   * Shuts down the buffer pool and cleans up resources
   */
  public shutdown(): void {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }

    // Clear all pools
    for (const pool of this.pools.values()) {
      pool.available.length = 0;
      pool.inUse.clear();
    }
    this.pools.clear();

    logger.info('BufferPool shut down');
  }

  /**
   * Forces cleanup of all pools (for testing/debugging)
   */
  public forceCleanup(): void {
    for (const pool of this.pools.values()) {
      pool.available.length = 0;
      pool.inUse.clear();
    }
    
    // Reset statistics
    this.stats = {
      acquisitions: 0,
      releases: 0,
      cacheHits: 0,
      cacheMisses: 0
    };

    logger.info('BufferPool force cleaned');
  }
}