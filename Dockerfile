# Multi-stage Docker build for Open Builder
# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package*.json ./
RUN npm ci --only=production

# Copy frontend source
COPY frontend/ ./

# Build frontend
RUN npm run build

# Stage 2: Final runtime image
FROM node:20-alpine AS runtime

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init curl bash coreutils findutils grep sed

# Create app directory and user
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && \
    adduser -S openbuilder -u 1001

# Copy backend package files
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

RUN npm install -g @osaas/cli

# Copy backend source files
COPY server.js ./
COPY mcp-permission-server.js ./
COPY .env.example ./
# Copy Claude Code settings to home directory for default permissions
COPY claude-code-settings.json /home/openbuilder/.claude/settings.json

# Copy built frontend from previous stage
COPY --from=frontend-builder /app/frontend/build ./frontend/build

# Create workspace directory with proper permissions
RUN mkdir -p /data && \
    chown -R openbuilder:nodejs /data && \
    chown -R openbuilder:nodejs /app

RUN chown -R openbuilder:nodejs /home/openbuilder/.claude

# Switch to non-root user
USER openbuilder

ENV PORT=8080
ENV CLAUDE_WORKSPACE_DIR=/data

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["npm", "start"]