FROM node:18-alpine

WORKDIR /

COPY package*.json ./

RUN npm ci

COPY . .

RUN rm -f .env

EXPOSE 3000

CMD ["node", "src/server.js"]
