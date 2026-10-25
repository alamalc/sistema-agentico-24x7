import {existsSync, readFileSync} from "node:fs";
import {resolve} from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "package.json",
  "package-lock.json",
  ".env.example",
  "Dockerfile",
  "docker-compose.yml",
  "supabase/migrations/202610240001_agentic_starter.sql",
  "infra/systemd/sistema-agentico-24x7.service"
];

let failed = false;
for (const relative of required) {
  const ok = existsSync(resolve(root, relative));
  process.stdout.write(`${ok ? "PASS" : "FAIL"} file ${relative}\n`);
  failed ||= !ok;
}

const example = readFileSync(resolve(root, ".env.example"), "utf8");
const hasOpenCodeCredential = /OPENCODE_GO_API_KEY=oc_[A-Za-z0-9]/u.test(example);
process.stdout.write(`${hasOpenCodeCredential ? "FAIL" : "PASS"} .env.example no contiene una clave OpenCode Go real\n`);
failed ||= hasOpenCodeCredential;

const hasDatabasePlaceholder = example.includes("DATABASE_URL=postgresql://postgres.example:replace-me@");
const hasDatabaseCredential = /DATABASE_URL=postgresql:\/\/(?!postgres\.example:replace-me@)[^\s]+/u.test(example);
process.stdout.write(`${hasDatabasePlaceholder && !hasDatabaseCredential ? "PASS" : "FAIL"} DATABASE_URL usa un marcador explícito\n`);
failed ||= !hasDatabasePlaceholder || hasDatabaseCredential;
process.stdout.write(`${failed ? "FAIL" : "PASS"} doctor complete\n`);
process.exitCode = failed ? 1 : 0;
