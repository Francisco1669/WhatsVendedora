FROM node:20-alpine AS dependencies

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src

EXPOSE 3333

CMD ["node", "src/server.js"]
