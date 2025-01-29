# Generated by https://smithery.ai. See: https://smithery.ai/docs/config#dockerfile
# Use an official Node.js image as the base
FROM node:18-alpine AS builder

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code to the working directory
COPY . .

# Build the TypeScript code
RUN npm run build

# Use a lightweight Node.js image to run the app
FROM node:18-alpine AS runner

# Set the working directory
WORKDIR /app

# Copy built application from the builder
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Set environment variables
ENV NODE_ENV=production

# Expose the port the app runs on
EXPOSE 3000

# Run the application
ENTRYPOINT ["node", "build/index.js"]
