# Stage 1: Build
FROM --platform=linux/amd64 node:22.9.0-alpine AS build

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci --frozen-lockfile

# Copy source code and config files
COPY src/ ./src/
COPY tsconfig.json tsconfig.build.json ./

# Build the application
RUN npm run build

# Stage 2: Production
FROM --platform=linux/amd64 node:22.9.0-alpine

# Set production environment
ENV NODE_ENV=production \
    NODE_OPTIONS="--enable-source-maps" \
    NPM_CONFIG_LOGLEVEL=warn \
    OTEL_SERVICE_NAME=twilio-bedrock-bridge \
    OTEL_SERVICE_VERSION=0.1.0 \
    OTEL_RESOURCE_ATTRIBUTES="service.name=twilio-bedrock-bridge,service.version=0.1.0" \
    ENABLE_XRAY=true \
    OTEL_NODE_DISABLED_INSTRUMENTATIONS="aws-sdk" \
    OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4317" \
    OTEL_EXPORTER_OTLP_PROTOCOL="grpc" \
    OTEL_METRICS_EXPORTER="otlp" \
    OTEL_LOGS_EXPORTER="otlp"

# Install runtime dependencies and create user in single layer
RUN apk add --no-cache curl dumb-init && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy package files for production dependencies
COPY package.json package-lock.json ./

# Install only production dependencies (using newer --omit flag)
RUN npm ci --frozen-lockfile --omit=dev && \
    npm cache clean --force

# Copy built application from build stage
COPY --from=build --chown=nodejs:nodejs /app/dist ./dist

# Switch to non-root user
USER nodejs

# Expose the port the app runs on
EXPOSE 3000

# Add health check using Kubernetes liveness probe
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health/liveness || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "--require", "@aws/aws-distro-opentelemetry-node-autoinstrumentation/register", "dist/server.js"]