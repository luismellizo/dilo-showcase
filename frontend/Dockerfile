FROM node:20-alpine AS build

WORKDIR /app

COPY frontend/package*.json ./
RUN npm install --legacy-peer-deps

# Stub out fork-ts-checker-webpack-plugin to avoid ajv@8 schema keyword conflicts
RUN node -e " \
  const fs = require('fs'); \
  const dir = 'node_modules/fork-ts-checker-webpack-plugin'; \
  if (fs.existsSync(dir)) { \
    const pkg = JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8')); \
    const main = dir + '/' + (pkg.main || 'lib/index.js'); \
    fs.writeFileSync(main, 'module.exports = class ForkTsCheckerStub { apply() {} };'); \
    console.log('fork-ts-checker stubbed at', main); \
  } \
"

COPY frontend/ .

ARG REACT_APP_API_URL
ENV REACT_APP_API_URL=$REACT_APP_API_URL
ARG REACT_APP_GOOGLE_CLIENT_ID
ENV REACT_APP_GOOGLE_CLIENT_ID=$REACT_APP_GOOGLE_CLIENT_ID
# Embedded Signup de Meta. CRA congela estas vars en el bundle en tiempo de
# build: sin declararlas aquí el botón "Conectar WhatsApp" queda muerto en
# producción aunque estén definidas en el entorno del contenedor.
ARG REACT_APP_META_APP_ID
ENV REACT_APP_META_APP_ID=$REACT_APP_META_APP_ID
ARG REACT_APP_META_CONFIG_ID
ENV REACT_APP_META_CONFIG_ID=$REACT_APP_META_CONFIG_ID
ARG REACT_APP_META_GRAPH_VERSION
ENV REACT_APP_META_GRAPH_VERSION=$REACT_APP_META_GRAPH_VERSION
ENV GENERATE_SOURCEMAP=false
ENV CI=false
ENV DISABLE_ESLINT_PLUGIN=true

RUN npm run build

FROM nginx:alpine

COPY --from=build /app/build /usr/share/nginx/html
# Plantilla (no conf.d directo): la imagen de nginx corre envsubst sobre
# /etc/nginx/templates/*.template al arrancar, sustituyendo ${BACKEND_ORIGIN}
# con el valor real del entorno — necesario porque backend y frontend son
# apps separadas en el PaaS (sin red de compose compartida por nombre).
COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template
ENV BACKEND_ORIGIN=http://backend:8000

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
