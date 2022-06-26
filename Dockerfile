FROM node:16-bullseye as build-client

WORKDIR /build/
COPY client/package.json client/yarn.lock /build/
RUN yarn install --frozen-lockfile
COPY client /build
RUN yarn build

FROM node:16-bullseye

WORKDIR /app/
COPY server/package.json server/yarn.lock /app/
RUN yarn install --frozen-lockfile
COPY server/* /app/
COPY --from=build-client /build/dist /app/static

RUN cp /app/node_modules/socket.io/client-dist/socket.io.js /app/static/socket.io.js

CMD node server.js
