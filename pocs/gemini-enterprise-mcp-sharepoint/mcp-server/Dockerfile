FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY index.js ./
COPY mock_data/ ./mock_data/

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000
CMD ["node", "index.js"]
