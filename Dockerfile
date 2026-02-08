FROM node:22 AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable pnpm && corepack install -g pnpm@latest
RUN pnpm install -g tsx

FROM base AS build
COPY . /usr/src/app
WORKDIR /usr/src/app
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
#RUN pnpm run -r build
RUN pnpm deploy --filter=@mmo/login-server --prod /prod/login-server
RUN pnpm deploy --filter=@mmo/server --prod /prod/server
RUN pnpm deploy --filter=@mmo/social-server --prod /prod/social-server
RUN pnpm deploy --filter=@mmo/client --prod /prod/client

FROM base AS server
ENV NODE_ENV=production
WORKDIR /prod/server
COPY --from=build /prod/server /prod/server
COPY --from=build /usr/src/app/packages/shared/assets/ /prod/packages/shared/assets/
RUN pnpm build
EXPOSE 2567
CMD ["pnpm", "start:prod"]

FROM base AS login-server
ENV NODE_ENV=production
WORKDIR /prod/login-server
COPY --from=build /prod/login-server /prod/login-server
RUN pnpm build
EXPOSE 3000
CMD ["pnpm", "start:prod"]

FROM base AS social-server
ENV NODE_ENV=production
WORKDIR /prod/social-server
COPY --from=build /prod/social-server /prod/social-server
RUN pnpm build
EXPOSE 2568
CMD ["pnpm", "start:prod"]

FROM base AS client
# TODO: don't install/use vite. Instead, serve using e.g., nginx or minimal express static server.
ENV NODE_ENV=production
WORKDIR /prod/client
COPY --from=build /prod/client /prod/client
RUN pnpm build
EXPOSE 80
# TODO: don't use preview. Instead, serve using e.g., nginx or minimal express static server.
CMD ["pnpm", "preview"]
