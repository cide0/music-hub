# Pinned deliberately (rather than :latest) so builds stay reproducible.
FROM node:22-alpine

WORKDIR /app

# Install dependencies first so this layer is cached between code changes.
COPY package*.json ./
RUN npm install

COPY . .

ENV PORT=8080
EXPOSE 8080

# Production entrypoint (Render). Local dev overrides this with nodemon
# via docker-compose.yml.
CMD ["npm", "start"]
