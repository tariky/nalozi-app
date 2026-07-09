import { getDB } from '../db';
import { requireAuth, requireAdmin, validateCsrf } from './auth';
import type { CompanySettings, CompanySettingsForm } from '../types';

// Max size of the logo data-URI string (~200KB). Logos are small; this keeps
// the settings row light and blocks accidental large uploads.
const MAX_LOGO_LENGTH = 200 * 1024;

function loadSettings(): CompanySettings {
  const db = getDB();
  return db.query<CompanySettings, []>(
    'SELECT * FROM company_settings WHERE id = 1'
  ).get()!;
}

// GET /api/settings/company - Read company settings (any authenticated user)
export function getCompanySettings(req: Request): Response {
  const authResult = requireAuth(req);
  if (authResult instanceof Response) return authResult;

  return Response.json(loadSettings());
}

// PUT /api/settings/company - Update company settings (admin only)
export async function updateCompanySettings(req: Request): Promise<Response> {
  const authResult = requireAdmin(req);
  if (authResult instanceof Response) return authResult;
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const data: CompanySettingsForm = await req.json();

  // Validate logo: must be an image data-URI within the size limit (or null/empty).
  if (data.logo) {
    if (!/^data:image\/(png|jpeg|jpg|svg\+xml);base64,/.test(data.logo)) {
      return Response.json(
        { message: 'Logo mora biti slika (PNG, JPG ili SVG)' },
        { status: 400 }
      );
    }
    if (data.logo.length > MAX_LOGO_LENGTH) {
      return Response.json(
        { message: 'Logo je prevelik (maksimalno 200KB)' },
        { status: 400 }
      );
    }
  }

  const db = getDB();
  db.query<null, [string | null, string | null, string | null, string | null, string | null, string | null, string | null]>(
    `UPDATE company_settings
     SET naziv = ?, telefon = ?, email = ?, adresa = ?, id_broj = ?, web = ?, logo = ?, updated_at = datetime('now')
     WHERE id = 1`
  ).run(
    data.naziv || null,
    data.telefon || null,
    data.email || null,
    data.adresa || null,
    data.id_broj || null,
    data.web || null,
    data.logo || null
  );

  return Response.json(loadSettings());
}
