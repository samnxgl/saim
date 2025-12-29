# Use Node.js 20 LTS
FROM node:20-slim

# Install OpenSSL for Prisma (if needed in future)
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev for build)
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

# Create logs directory
RUN mkdir -p logs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start the application
CMD ["npm", "start"]
