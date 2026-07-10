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
let parsed = 0;
let failed = 0;
for (let i = 0; i < 3; i++) {
  const res = await callOpenRouterVision(
    apiKey,
    "google/gemini-3.5-flash",
    buildRegistrationMessages(dataUrl)
  );
  if (!res.ok) {
    console.log(`run ${i + 1}: HTTP`, res.response.status);
    failed++;
    continue;
  }
  try {
    const { document, warnings } = parseRegistrationResponse(res.content);
    console.log(`run ${i + 1}:`, JSON.stringify(document), warnings);
    parsed++;
  } catch (err) {
    // Vision model occasionally returns content that is not valid JSON.
    // Print the run, error, and raw response excerpt so the bad reply can be
    // inspected and debugged — don't retry or silently swallow it.
    const preview = res.content.substring(0, 200);
    console.log(
      `run ${i + 1}: parse error`,
      err instanceof Error ? err.message : String(err)
    );
    console.log(`  raw content (first 200 chars): ${preview}`);
    failed++;
  }
}

// Report summary. Exit non-zero only if no runs succeeded, making this usable
// as a smoke test. Mixed success/failure (some runs parsed, some did not) means
// the model is flaky but the script fulfilled its purpose: gathering evidence.
console.log(`\nsummary: ${parsed} parsed, ${failed} failed`);
if (parsed === 0) {
  process.exit(1);
}
