// Registra el hook de resolución de alias "@/" para el harness de tests unitarios.
// Se carga con `node --import ./scripts/test-register.mjs --test ...`. Tooling de
// test solamente: no se importa desde el código de runtime de la app.
import { register } from "node:module";

register("./test-alias-hook.mjs", import.meta.url);
