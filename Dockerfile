# syntax=docker/dockerfile:1

# --- Frontends: display app (/) and Management (/admin/) --------------------
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN NX_DAEMON=false npx nx run-many -t build -p display management

# --- API ---------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS api
ARG TARGETARCH
# bash, for the ${TARGETARCH/amd64/x64} substitution that dash lacks
SHELL ["/bin/bash", "-c"]
WORKDIR /src
COPY apps/api/HomeyDash.Api.csproj apps/api/
RUN dotnet restore apps/api/HomeyDash.Api.csproj -a ${TARGETARCH/amd64/x64}
COPY apps/api apps/api
COPY libs/design-system/backgrounds libs/design-system/backgrounds
RUN dotnet publish apps/api/HomeyDash.Api.csproj -c Release -a ${TARGETARCH/amd64/x64} \
    --no-restore -p:UseAppHost=false -o /rootfs/app
# The chiseled image has no shell, so prepare the data directory here.
RUN mkdir /rootfs/data && chown $APP_UID:$APP_UID /rootfs/data

# --- Runtime filesystem, assembled so the final image gets it in one layer ---
FROM api AS rootfs
COPY --from=frontend /src/dist/apps/display/browser /rootfs/app/frontends/display
COPY --from=frontend /src/dist/apps/management/browser /rootfs/app/frontends/admin

# --- Runtime: chiseled (distroless, non-root) --------------------------------
FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled AS final
COPY --from=rootfs /rootfs /
WORKDIR /app

ENV ASPNETCORE_HTTP_PORTS=8080 \
    ConnectionStrings__HomeyDash="Data Source=/data/homey-dash.db"
VOLUME /data
EXPOSE 8080 8443
USER $APP_UID
ENTRYPOINT ["dotnet", "HomeyDash.Api.dll"]
