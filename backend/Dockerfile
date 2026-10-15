# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./

# Install all dependencies (including devDependencies)
RUN npm ci --ignore-scripts

COPY . .

# Production runner stage
FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production --ignore-scripts

# Copy source code from builder
COPY --from=builder /app /app

# Create logs directory and set ownership
RUN adduser --disabled-password --gecos "" backend && \
    mkdir -p logs uploads && \
    chown -R backend:backend /app

USER backend

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
CMD ["node", "src/server.js"]