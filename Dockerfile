FROM node:22-slim

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev=false
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

CMD ["node", "dist/index.js"]
