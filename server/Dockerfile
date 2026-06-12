FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm ci
COPY server ./server
COPY demo ./demo
# seed-vault.mjs creates the vault from scratch (files + inner git repo)
RUN cd server && npx tsc && node ../demo/seed-vault.mjs /app/vault
ENV MODE=http PORT=3000 VAULT_PATH=/app/vault
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
