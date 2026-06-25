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

async function readExistingContent() {
  try {
    return await readFile(outputPath, "utf8");
  } catch {
    return null;
  }
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

function checkDrift(existingContent, newContent) {
  if (existingContent === null) {
    fail(
      "No existe src/generated/openapi.ts. Ejecute generate:api y versiona el resultado.",
    );
  }

  if (existingContent !== newContent) {
    fail(
      "El contrato OpenAPI generado cambió. Ejecute generate:api y versiona el resultado.",
    );
  }

  console.log("[check:api] Sin drift en src/generated/openapi.ts");
}

if (shouldCheck) {
  const existing = await readExistingContent();
  const generated = await generateContent();
  checkDrift(existing, generated);
} else {
  const content = await generateContent();
  await writeAtomic(content);
}