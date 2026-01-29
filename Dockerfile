FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN echo "=== PRISMA GENERATE STEP START ==="
RUN npx prisma generate
RUN echo "=== PRISMA GENERATE STEP END ==="

RUN npm run build

CMD ["npm","start"]
