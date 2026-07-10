// Sends one real photo through the live prompt and prints the parsed document.
// Unit tests prove the parser deterministically; only a real vision-model call
// proves the prompt actually steers the model the way the tests assume.
// Usage: bun scripts/verify-registration-scan.ts <path-to-photo.jpg>
import { buildRegistrationMessages, parseRegistrationResponse } from "../src/api/registration-scan";
import { callOpenRouterVision } from "../src/api/vision";

const path = process.argv[2];
if (!path) {
  console.error("usage: bun scripts/verify-registration-scan.ts <photo>");
  process.exit(1);
}

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error("OPENROUTER_API_KEY is not set (Bun loads .env automatically — check it's present there)");
  process.exit(1);
}

const file = Bun.file(path);
if (!(await file.exists())) {
  console.error(`photo not found: ${path}`);
  process.exit(1);
}

const bytes = new Uint8Array(await file.arrayBuffer());
const dataUrl = `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;

// The vision model is nondeterministic; run several times and print every
// result verbatim so a single bad read doesn't hide behind a lucky rerun.
for (let i = 0; i < 3; i++) {
  const res = await callOpenRouterVision(
    apiKey,
    "google/gemini-3.5-flash",
    buildRegistrationMessages(dataUrl)
  );
  if (!res.ok) {
    console.log(`run ${i + 1}: HTTP`, res.response.status);
    continue;
  }
  const { document, warnings } = parseRegistrationResponse(res.content);
  console.log(`run ${i + 1}:`, JSON.stringify(document), warnings);
}
