FROM node:20-alpine AS builder
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --include=dev
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY frontend ./frontend
EXPOSE 4000
CMD ["node", "dist/index.js"]