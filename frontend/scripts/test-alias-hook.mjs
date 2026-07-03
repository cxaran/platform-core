// Hook de resolución ESM SÓLO para el harness de tests unitarios (node --test).
// Replica lo que hace el bundler de Next para que los módulos sean cargables:
//   1. Alias de imports "@/..." -> "src/..." (tsconfig paths "@/*" -> "./src/*").
//   2. Resolución de extensión (.ts/.tsx/.mjs/.js) e índice en imports SIN extensión,
//      tanto para el alias como para imports relativos (p.ej. "./request").
// No afecta al runtime de la app: sólo se registra cuando los scripts test:* lo cargan
// con --import. Cualquier especificador que no encaje pasa intacto al resolutor default.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "src");
const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js"];

function withResolvedExtension(absPath) {
  if (path.extname(absPath)) {
    return absPath;
  }
  for (const ext of EXTENSIONS) {
    if (existsSync(absPath + ext)) {
      return absPath + ext;
    }
  }
  for (const ext of EXTENSIONS) {
    const indexed = path.join(absPath, `index${ext}`);
    if (existsSync(indexed)) {
      return indexed;
    }
  }
  return absPath;
}

export async function resolve(specifier, context, next) {
  // 1. Alias "@/..." -> "src/...".
  if (specifier.startsWith("@/")) {
    const target = withResolvedExtension(path.join(SRC_DIR, specifier.slice(2)));
    return next(pathToFileURL(target).href, context);
  }
  // 2. Import relativo sin extensión: resolver contra el módulo padre como el bundler.
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !path.extname(specifier) &&
    context.parentURL
  ) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const target = withResolvedExtension(path.resolve(parentDir, specifier));
    if (path.extname(target)) {
      return next(pathToFileURL(target).href, context);
    }
  }
  return next(specifier, context);
}
