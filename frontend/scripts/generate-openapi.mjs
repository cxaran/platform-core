import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import openapiTS, { astToString } from "openapi-typescript";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(frontendRoot, "src/generated/openapi.ts");
const outputPathRelative = "src/generated/openapi.ts";
const shouldCheck = process.argv.includes("--check");

function fail(message) {
  console.error(`[generate:api] ${message}`);
  process.exit(1);
}

function readOpenApiUrl() {
  const raw = process.env.OPENAPI_URL;
  if (!raw) {
    fail(
      "OPENAPI_URL es obligatorio. Ejemplo: OPENAPI_URL=http://backend:8000/api/openapi.json",
    );
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("OPENAPI_URL debe ser una URL válida.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    fail("OPENAPI_URL debe usar http o https.");
  }

  return url;
}

function safeUrlForLog(url) {
  const safe = new URL(url);
  safe.username = "";
  safe.password = "";
  safe.search = "";
  return safe.toString();
}

async function fetchOpenApi(url) {
  console.log(`[generate:api] Origen OpenAPI: ${safeUrlForLog(url)}`);

  let response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
    });
  } catch {
    fail(`No se pudo conectar con FastAPI en ${safeUrlForLog(url)}.`);
  }

  if (!response.ok) {
    fail(
      `FastAPI respondió ${response.status} ${response.statusText} al solicitar OpenAPI.`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    fail(
      `FastAPI respondió content-type "${contentType}", se esperaba application/json.`,
    );
  }

  const schema = await response.json();

  if (
    !schema ||
    typeof schema !== "object" ||
    !("openapi" in schema) ||
    !("paths" in schema)
  ) {
    fail("La respuesta no es un documento OpenAPI válido.");
  }

  return schema;
}

async function generateContent() {
  const openApiUrl = readOpenApiUrl();
  const schema = await fetchOpenApi(openApiUrl);
  const ast = await openapiTS(schema);
  const source = astToString(ast);
  const header =
    "// Generado automáticamente por scripts/generate-openapi.mjs. No editar manualmente.\n\n";
  return `${header}${source}`;
}

// Normaliza saltos de línea para que la comparación no produzca falsos
// positivos entre Windows (CRLF) y Linux/Docker (LF).
function normalize(content) {
  return content.replace(/\r\n/g, "\n");
}

async function readExistingContent() {
  try {
    return await readFile(outputPath, "utf8");
  } catch {
    return null;
  }
}

// Modo generate:api -> escribe el archivo generado de forma atómica.
async function writeAtomic(content) {
  const dir = dirname(outputPath);
  await mkdir(dir, { recursive: true });

  const tempPath = `${outputPath}.tmp`;
  await writeFile(tempPath, content, "utf8");
  try {
    await unlink(outputPath);
  } catch {
    // El archivo puede no existir en la primera generación.
  }
  await rename(tempPath, outputPath);

  console.log(`[generate:api] Tipos generados en ${outputPathRelative}`);
}

// Modo check:api -> compara el contenido generado contra el archivo en disco
// sin modificarlo. Detecta tanto drift del backend como ediciones manuales.
async function checkDrift(newContent) {
  const existing = await readExistingContent();

  if (existing === null) {
    fail(
      `No existe ${outputPathRelative}. Ejecute generate:api y versiona el resultado.`,
    );
  }

  if (normalize(existing) !== normalize(newContent)) {
    fail(
      `${outputPathRelative} está desactualizado o fue editado manualmente. ` +
        "Ejecute generate:api y versiona el resultado.",
    );
  }

  console.log(`[check:api] Sin drift en ${outputPathRelative}`);
}

const content = await generateContent();

if (shouldCheck) {
  await checkDrift(content);
} else {
  await writeAtomic(content);
}
