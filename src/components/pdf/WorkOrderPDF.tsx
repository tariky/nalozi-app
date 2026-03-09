import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
  Font,
} from "@react-pdf/renderer";
import type { WorkOrder } from "@/types";

// Register Roboto font which supports Eastern European characters (čćžšđ)
Font.register({
  family: "Roboto",
  fonts: [
    {
      src: "https://cdnjs.cloudflare.com/ajax/libs/ink/3.1.10/fonts/Roboto/roboto-regular-webfont.ttf",
      fontWeight: "normal",
    },
    {
      src: "https://cdnjs.cloudflare.com/ajax/libs/ink/3.1.10/fonts/Roboto/roboto-bold-webfont.ttf",
      fontWeight: "bold",
    },
  ],
});

// Styles for PDF document
const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: "Roboto",
  },
  header: {
    marginBottom: 30,
    borderBottom: "2 solid #333",
    paddingBottom: 15,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 12,
    color: "#666",
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "bold",
    marginBottom: 10,
    backgroundColor: "#f5f5f5",
    padding: 8,
  },
  row: {
    flexDirection: "row",
    marginBottom: 5,
  },
  label: {
    width: "40%",
    color: "#666",
  },
  value: {
    width: "60%",
    fontWeight: "bold",
  },
  twoColumn: {
    flexDirection: "row",
    gap: 20,
  },
  column: {
    flex: 1,
  },
  table: {
    marginTop: 10,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#333",
    color: "#fff",
    padding: 8,
    fontWeight: "bold",
  },
  tableRow: {
    flexDirection: "row",
    borderBottom: "1 solid #eee",
    padding: 8,
  },
  tableRowAlt: {
    flexDirection: "row",
    borderBottom: "1 solid #eee",
    padding: 8,
    backgroundColor: "#fafafa",
  },
  colType: { width: "10%" },
  colName: { width: "32%", paddingRight: 5 },
  colQty: { width: "10%", textAlign: "right" },
  colPrice: { width: "18%", textAlign: "right" },
  colDiscount: { width: "12%", textAlign: "right" },
  colTotal: { width: "18%", textAlign: "right" },
  totalsSection: {
    marginTop: 20,
    alignItems: "flex-end",
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 5,
    width: 200,
  },
  totalsLabel: {
    width: "50%",
    textAlign: "right",
    paddingRight: 10,
    color: "#666",
  },
  totalsValue: {
    width: "50%",
    textAlign: "right",
  },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 10,
    paddingTop: 10,
    borderTop: "2 solid #333",
    width: 200,
  },
  grandTotalLabel: {
    width: "50%",
    textAlign: "right",
    paddingRight: 10,
    fontSize: 14,
    fontWeight: "bold",
  },
  grandTotalValue: {
    width: "50%",
    textAlign: "right",
    fontSize: 14,
    fontWeight: "bold",
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: "center",
    color: "#999",
    fontSize: 8,
    borderTop: "1 solid #eee",
    paddingTop: 10,
  },
  notes: {
    marginTop: 10,
    padding: 10,
    backgroundColor: "#f9f9f9",
    borderRadius: 4,
  },
});

// Format currency for PDF (without using Intl which isn't available)
function formatCurrency(value: number): string {
  const parts = value.toFixed(2).split(".");
  const whole = parts[0] || "0";
  const decimal = parts[1] || "00";
  const withThousands = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return withThousands + "," + decimal + " KM";
}

// Format number with thousands separator for PDF
function formatNumber(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Format date for PDF
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

interface WorkOrderPDFDocumentProps {
  workOrder: WorkOrder;
}

function WorkOrderPDFDocument({ workOrder }: WorkOrderPDFDocumentProps) {
  const partsTotal =
    workOrder.items
      ?.filter((i) => i.tip === "dio")
      .reduce((sum, i) => sum + i.ukupna_cijena, 0) || 0;

  const servicesTotal =
    workOrder.items
      ?.filter((i) => i.tip === "usluga")
      .reduce((sum, i) => sum + i.ukupna_cijena, 0) || 0;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>RADNI NALOG</Text>
          <Text style={styles.subtitle}>
            Broj: {workOrder.broj_naloga} | Datum: {formatDate(workOrder.created_at)}
          </Text>
        </View>

        {/* Customer & Vehicle Info */}
        <View style={styles.twoColumn}>
          {/* Customer */}
          <View style={styles.column}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>PODACI O KLIJENTU</Text>
              <View style={styles.row}>
                <Text style={styles.label}>Ime i prezime:</Text>
                <Text style={styles.value}>
                  {workOrder.customer?.ime} {workOrder.customer?.prezime}
                </Text>
              </View>
              {workOrder.customer?.naziv_firme && (
                <View style={styles.row}>
                  <Text style={styles.label}>Firma:</Text>
                  <Text style={styles.value}>{workOrder.customer.naziv_firme}</Text>
                </View>
              )}
              {workOrder.customer?.telefon && (
                <View style={styles.row}>
                  <Text style={styles.label}>Telefon:</Text>
                  <Text style={styles.value}>{workOrder.customer.telefon}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Vehicle */}
          <View style={styles.column}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>PODACI O VOZILU</Text>
              <View style={styles.row}>
                <Text style={styles.label}>Marka/Model:</Text>
                <Text style={styles.value}>
                  {workOrder.marka_vozila} {workOrder.model_vozila}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Reg. tablice:</Text>
                <Text style={styles.value}>{workOrder.registarske_tablice}</Text>
              </View>
              {workOrder.vin_broj && (
                <View style={styles.row}>
                  <Text style={styles.label}>VIN:</Text>
                  <Text style={styles.value}>{workOrder.vin_broj}</Text>
                </View>
              )}
              {workOrder.motor && (
                <View style={styles.row}>
                  <Text style={styles.label}>Motor:</Text>
                  <Text style={styles.value}>{workOrder.motor}</Text>
                </View>
              )}
              {workOrder.kilometraza && (
                <View style={styles.row}>
                  <Text style={styles.label}>Kilometraža:</Text>
                  <Text style={styles.value}>{formatNumber(workOrder.kilometraza)} km</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Mechanic */}
        {workOrder.mechanic && (
          <View style={styles.section}>
            <View style={styles.row}>
              <Text style={{ color: "#666" }}>Mehaničar: </Text>
              <Text style={{ fontWeight: "bold" }}>
                {workOrder.mechanic.ime} {workOrder.mechanic.prezime}
              </Text>
            </View>
          </View>
        )}

        {/* Items Table */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>DIJELOVI I USLUGE</Text>
          <View style={styles.table}>
            {/* Table Header */}
            <View style={styles.tableHeader}>
              <Text style={styles.colType}>Tip</Text>
              <Text style={styles.colName}>Naziv</Text>
              <Text style={styles.colQty}>Kol.</Text>
              <Text style={styles.colPrice}>Cijena</Text>
              <Text style={styles.colDiscount}>Popust</Text>
              <Text style={styles.colTotal}>Ukupno</Text>
            </View>

            {/* Table Rows */}
            {workOrder.items?.map((item, index) => (
              <View
                key={item.id}
                style={index % 2 === 0 ? styles.tableRow : styles.tableRowAlt}
              >
                <Text style={styles.colType}>
                  {item.tip === "dio" ? "Dio" : "Usluga"}
                </Text>
                <Text style={styles.colName}>{item.naziv}</Text>
                <Text style={styles.colQty}>{item.kolicina}</Text>
                <Text style={styles.colPrice}>
                  {formatCurrency(item.jedinicna_cijena)}
                </Text>
                <Text style={styles.colDiscount}>
                  {item.popust > 0 ? `${item.popust}%` : "-"}
                </Text>
                <Text style={styles.colTotal}>
                  {formatCurrency(item.ukupna_cijena)}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Totals */}
        <View style={styles.totalsSection}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Dijelovi:</Text>
            <Text style={styles.totalsValue}>{formatCurrency(partsTotal)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Usluge:</Text>
            <Text style={styles.totalsValue}>{formatCurrency(servicesTotal)}</Text>
          </View>
          <View style={styles.grandTotal}>
            <Text style={styles.grandTotalLabel}>UKUPNO:</Text>
            <Text style={styles.grandTotalValue}>
              {formatCurrency(workOrder.ukupna_cijena)}
            </Text>
          </View>
        </View>

        {/* Job Description */}
        {workOrder.opis_kvara && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>OPIS KVARA / TRAŽENI POSAO</Text>
            <View style={styles.notes}>
              <Text>{workOrder.opis_kvara}</Text>
            </View>
          </View>
        )}

        {/* Notes */}
        {workOrder.napomena && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>NAPOMENA</Text>
            <View style={styles.notes}>
              <Text>{workOrder.napomena}</Text>
            </View>
          </View>
        )}

        {/* Footer */}
        <Text style={styles.footer}>
          AS-NORD Nalozi | Ovaj dokument je automatski generisan
        </Text>
      </Page>
    </Document>
  );
}

// Function to generate and download PDF
export async function generateWorkOrderPDF(workOrder: WorkOrder): Promise<void> {
  const blob = await pdf(<WorkOrderPDFDocument workOrder={workOrder} />).toBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `radni-nalog-${workOrder.broj_naloga}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export { WorkOrderPDFDocument };
