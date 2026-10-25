# Sistema agéntico 24/7

Starter kit reproducible para ejecutar un agente técnico en un VPS sin depender del computador personal. GitHub conserva el código; Supabase/Postgres conserva tareas, ejecuciones, eventos, artefactos y aprobaciones; PGMQ transporta identificadores; Docker rootless aísla el proceso; `systemd --user` mantiene el servicio activo.

El proyecto no publica en WordPress ni incluye una herramienta de escritura externa. Su salida es un brief técnico verificable. Añadir un efecto externo exige otro adaptador, una aprobación ligada al hash exacto y una reconciliación explícita para resultados ambiguos.

## Qué demuestra

- una tarea canónica con idempotencia, fecha límite y presupuesto;
- una cola durable que transporta sólo el `taskId`;
- un lease con vencimiento para recuperar una caída;
- fuentes HTTPS restringidas a una lista de hosts;
- artefactos con SHA-256 y hallazgos ligados a sus URL;
- un proveedor fixture que no necesita credenciales;
- un adaptador opt-in para OpenCode Go;
- un contenedor sin privilegios, filesystem de sólo lectura y capacidades eliminadas;
- un servicio `systemd --user`, healthcheck y respaldo lógico.

## Límites deliberados

Este repositorio es un punto de partida, no una promesa de autonomía general. El lector debe adaptar retención, costos, permisos, alertas y recuperación a su contexto. La cola evita perder trabajos, pero no vuelve idempotentes los efectos de negocio. La tabla canónica y sus claves únicas cumplen ese papel.

OpenCode Go está diseñado para OpenCode y otros agentes de código con tráfico similar. El adaptador de este kit se limita a briefs técnicos de ingeniería y debe usarse sólo si el caso cumple las condiciones vigentes del proveedor. Consulta el catálogo con `/models` o el endpoint oficial antes de definir `OPENCODE_GO_MODEL`; el código no fija un modelo que pueda desaparecer.

## Requisitos

- Node.js 24.16 y npm 11.13 para desarrollo;
- un proyecto Supabase compatible con `pgmq`;
- Supabase CLI para migraciones y pruebas RLS;
- un VPS Linux con Docker rootless, Compose v2 y `systemd --user`;
- `pg_dump` para respaldos;
- una cuenta OpenCode Go sólo si cambias `AGENT_PROVIDER=opencode-go`.

Fuentes oficiales de referencia:

- [Supabase Queues](https://supabase.com/docs/guides/queues)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Docker rootless](https://docs.docker.com/engine/security/rootless/)
- [systemd timers](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html)
- [OpenCode Go](https://dev.opencode.ai/v2/docs/console/go)

## 1. Instalar y verificar localmente

```bash
npm ci --ignore-scripts
npm run doctor
npm run build
npm test
```

El modo predeterminado es `fixture`. Las pruebas no llaman a OpenCode Go ni a Supabase remoto.

## 2. Crear el plano de control en Supabase

Vincula el proyecto y aplica la migración con el flujo recomendado por tu organización. En un entorno local:

```bash
supabase start
supabase db reset
supabase test db
```

La migración crea cinco tablas en `public`, activa RLS, revoca permisos heredados y añade políticas para un claim JWT `workspace_id`. El worker no usa una clave publicable. Recibe una conexión PostgreSQL privilegiada únicamente en el VPS.

Antes de producción, prueba también las políticas con los roles `anon` y `authenticated`. Una política correcta no compensa un `GRANT` excesivo.

## 3. Configurar sin guardar secretos en Git

```bash
cp .env.example .env
chmod 600 .env
```

Edita los valores:

- `DATABASE_URL`: conexión directa o pooler apto para el worker;
- `WORKSPACE_ID`: frontera estable para tareas y artefactos;
- `SOURCE_HOST_ALLOWLIST`: dominios oficiales que el lector puede consultar;
- `AGENT_PROVIDER=fixture`: modo inicial y de diagnóstico.

Para OpenCode Go:

```dotenv
AGENT_PROVIDER=opencode-go
OPENCODE_GO_API_KEY=valor-entregado-por-el-proveedor
OPENCODE_GO_MODEL=modelo-confirmado-en-el-catalogo-actual
```

El adaptador envía un `User-Agent` propio y un `x-opencode-session` estable por ejecución. La clave no se registra en eventos ni artefactos.

## 4. Encolar una tarea y ejecutar una vez

Compila y crea la tarea de ejemplo:

```bash
npm run build
npm run cli -- enqueue examples/task.json
npm run worker:once
```

Repetir `enqueue` con la misma `idempotencyKey` devuelve `EXISTS` y el mismo `taskId`. La tarea no se duplica.

## 5. Empaquetar con Docker rootless

Instala Docker rootless según la documentación oficial y confirma que `docker info` muestre `rootless`. Después:

```bash
docker compose config --quiet
docker compose build --pull
docker compose up -d worker
docker compose ps
```

El contenedor corre como UID 10001, elimina capacidades, usa `no-new-privileges`, monta `/tmp` en memoria y mantiene el filesystem de aplicación en sólo lectura.

## 6. Mantenerlo activo tras reinicios

En el VPS, instala los archivos del directorio `infra/systemd` en `~/.config/systemd/user/` y ejecuta:

```bash
systemctl --user daemon-reload
systemctl --user enable --now docker.service
systemctl --user enable --now sistema-agentico-24x7.service
systemctl --user enable --now sistema-agentico-backup.timer
sudo loginctl enable-linger "$USER"
```

`enable-linger` permite que el administrador de servicios del usuario exista después de cerrar sesión y durante el arranque. Comprueba el resultado sin depender de una consola abierta:

```bash
systemctl --user status sistema-agentico-24x7.service
systemctl --user list-timers sistema-agentico-backup.timer
docker compose ps
```

## 7. Probar caída y recuperación

1. Encola una tarea con el fixture.
2. Ejecuta una sola vez con `REHEARSAL_CRASH_AFTER_LEASE=true`. Esta bandera sólo es válida con el proveedor fixture y provoca una salida después de adquirir el lease, antes de leer fuentes o crear un artefacto.
3. Confirma que la tarea quedó `RUNNING`, el mensaje sigue sin archivar y no existe ningún artefacto.
4. Espera más que `LEASE_SECONDS` y vuelve a ejecutar con `REHEARSAL_CRASH_AFTER_LEASE=false`.
5. Confirma un único artefacto por `(task_id, kind)`, dos intentos y un evento `LEASE_RECOVERED`.
6. Confirma que la primera ejecución quedó `BLOCKED` con `LEASE_EXPIRED` y la segunda terminó `SUCCEEDED`.

La visibilidad de PGMQ permite volver a entregar el mensaje. La restricción única del artefacto evita duplicar la salida. La bandera de rehearsal debe permanecer en `false` durante operación normal. Un conector con efectos remotos necesita además su propia idempotencia y una ruta `RECONCILING`.

## 8. Respaldar y restaurar

El timer ejecuta un `pg_dump` diario, guarda un archivo con permisos `0600` y crea su SHA-256. Copia esos archivos a una ubicación separada del VPS. Los respaldos administrados de Supabase no incluyen necesariamente los objetos de Storage, y una restauración debe ensayarse antes de que exista una emergencia.

Ejemplo de verificación:

```bash
sha256sum --check backups/agentic-AAAAMMDDTHHMMSSZ.dump.sha256
createdb agentic_restore_test
pg_restore --dbname=agentic_restore_test backups/agentic-AAAAMMDDTHHMMSSZ.dump
```

No restaures sobre producción para “probar”. Usa una base temporal y documenta el tiempo, los objetos excluidos y las credenciales que deban rotarse.

## Operación diaria

```bash
npm run cli -- health
docker compose logs --since=30m worker
systemctl --user is-active sistema-agentico-24x7.service
systemctl --user list-timers sistema-agentico-backup.timer
```

Los logs contienen estados y códigos de error, nunca claves, documentos completos ni razonamiento privado. Los documentos recuperados y los briefs viven en PostgreSQL con su procedencia.

## Extensiones seguras

Antes de añadir una herramienta con efectos:

1. define un contrato estrecho;
2. separa lectura de escritura;
3. liga la aprobación al payload exacto y a una vigencia;
4. usa una idempotencia entendida por el sistema remoto;
5. registra un marcador antes de la llamada;
6. verifica el efecto por una lectura independiente;
7. ante timeout o desconexión, pasa a `RECONCILING` y no repitas a ciegas.

La licencia MIT cubre el código. Las marcas y servicios mencionados pertenecen a sus respectivos titulares.
