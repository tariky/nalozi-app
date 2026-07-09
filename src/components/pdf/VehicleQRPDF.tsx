import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  pdf,
  Font,
} from "@react-pdf/renderer";
import type { Vehicle, CompanySettings } from "@/types";

Font.register({
  family: "Roboto",
  fonts: [
    { src: "https://cdnjs.cloudflare.com/ajax/libs/ink/3.1.10/fonts/Roboto/roboto-regular-webfont.ttf", fontWeight: "normal" },
    { src: "https://cdnjs.cloudflare.com/ajax/libs/ink/3.1.10/fonts/Roboto/roboto-bold-webfont.ttf", fontWeight: "bold" },
  ],
});

const styles = StyleSheet.create({
  page: { padding: 48, fontFamily: "Roboto", fontSize: 11, alignItems: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 40 },
  logo: { width: 48, height: 48, objectFit: "contain" },
  companyName: { fontSize: 16, fontWeight: "bold" },
  companyDetail: { fontSize: 9, color: "#666" },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 6, textAlign: "center" },
  vehicle: { fontSize: 14, color: "#333", marginBottom: 4, textAlign: "center" },
  plates: { fontSize: 12, color: "#666", marginBottom: 30, textAlign: "center" },
  qr: { width: 260, height: 260, marginBottom: 24 },
  instruction: { fontSize: 12, textAlign: "center", maxWidth: 340, marginBottom: 16, color: "#333" },
  url: { fontSize: 9, color: "#888", textAlign: "center" },
  footer: { position: "absolute", bottom: 30, left: 48, right: 48, textAlign: "center", color: "#999", fontSize: 8 },
});

function canRenderLogo(logo: string | null | undefined): logo is string {
  return !!logo && /^data:image\/(png|jpe?g);base64,/.test(logo);
}

interface VehicleQRDocumentProps {
  vehicle: Vehicle;
  company?: CompanySettings | null;
  qrDataUrl: string;
  url: string;
}

function VehicleQRDocument({ vehicle, company, qrDataUrl, url }: VehicleQRDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {company && (company.naziv || canRenderLogo(company.logo)) && (
          <View style={styles.header}>
            {canRenderLogo(company.logo) && <Image style={styles.logo} src={company.logo!} />}
            <View>
              {company.naziv && <Text style={styles.companyName}>{company.naziv}</Text>}
              {company.telefon && <Text style={styles.companyDetail}>Tel: {company.telefon}</Text>}
            </View>
          </View>
        )}

        <Text style={styles.title}>Servisna historija vozila</Text>
        <Text style={styles.vehicle}>{vehicle.marka_vozila} {vehicle.model_vozila}</Text>
        <Text style={styles.plates}>{vehicle.registarske_tablice}</Text>

        <Image style={styles.qr} src={qrDataUrl} />

        <Text style={styles.instruction}>
          Skenirajte QR kod telefonom za uvid u kompletnu servisnu historiju ovog vozila.
        </Text>
        <Text style={styles.url}>{url}</Text>

        <Text style={styles.footer}>AS-NORD Nalozi | Automatski generisano</Text>
      </Page>
    </Document>
  );
}

export async function generateVehicleQRPDF(
  vehicle: Vehicle,
  company: CompanySettings | null | undefined,
  qrDataUrl: string,
  url: string
): Promise<void> {
  const blob = await pdf(
    <VehicleQRDocument vehicle={vehicle} company={company} qrDataUrl={qrDataUrl} url={url} />
  ).toBlob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `qr-servisna-historija-${vehicle.registarske_tablice}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}
