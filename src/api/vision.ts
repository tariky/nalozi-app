// Shared plumbing for image -> vision model -> text scans.
// The invoice scanner and the registration scanner run the same pipeline and
// differ only in prompt, model and parser.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_BYTES = 8 * 1024 * 1024; // 8MB
const TIMEOUT_MS = 45_000;

export interface VisionMessage {
  role: "system" | "user";
  content:
    | string
    | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
}

export type ImageUpload =
  | { ok: true; dataUrl: string }
  | { ok: false; response: Response };

export async function readImageUpload(req: Request): Promise<ImageUpload> {
  const invalid = () => ({
    ok: false as const,
    response: Response.json({ message: "Slika nije validna" }, { status: 400 }),
  });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return invalid();
  }

  const file = formData.get("file");
  if (!(file instanceof File) || !file.type.startsWith("image/")) return invalid();
  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      response: Response.json({ message: "Slika je prevelika (max 8MB)" }, { status: 400 }),
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  return { ok: true, dataUrl: `data:${file.type};base64,${Buffer.from(bytes).toString("base64")}` };
}

export type VisionResult =
  | { ok: true; content: string }
  | { ok: false; response: Response };

export async function callOpenRouterVision(
  apiKey: string,
  model: string,
  messages: VisionMessage[]
): Promise<VisionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages, response_format: { type: "json_object" } }),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return {
        ok: false,
        response: Response.json({ message: "Vrijeme za obradu isteklo" }, { status: 504 }),
      };
    }
    return {
      ok: false,
      response: Response.json({ message: "OpenRouter nedostupan" }, { status: 502 }),
    };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`OpenRouter HTTP ${res.status}:`, text.slice(0, 500));
    return {
      ok: false,
      response: Response.json({ message: "OpenRouter greška" }, { status: 502 }),
    };
  }

  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    return {
      ok: false,
      response: Response.json({ message: "Model nije vratio sadržaj" }, { status: 422 }),
    };
  }
  return { ok: true, content };
}
