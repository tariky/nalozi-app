import { useState, useEffect } from "react";
import type { PublicServiceHistoryData } from "@/types";

function formatDate(dateString: string): string {
  const d = new Date(dateString);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${d.getFullYear()}`;
}

function canRenderLogo(logo: string | null): logo is string {
  return !!logo && /^data:image\//.test(logo);
}

export function PublicServiceHistory({ token }: { token: string }) {
  const [data, setData] = useState<PublicServiceHistoryData | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "notfound">("loading");

  useEffect(() => {
    fetch(`/api/public/service-history/${encodeURIComponent(token)}`)
      .then((res) => {
        if (!res.ok) throw new Error("notfound");
        return res.json();
      })
      .then((d: PublicServiceHistoryData) => {
        setData(d);
        setStatus("ok");
      })
      .catch(() => setStatus("notfound"));
  }, [token]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Učitavanje...
      </div>
    );
  }

  if (status === "notfound" || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 text-center">
        <p className="text-muted-foreground">Vozilo nije pronađeno.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-5 py-8">
        {/* Brand */}
        <div className="flex items-center gap-3 mb-8">
          {canRenderLogo(data.company.logo) && (
            <img src={data.company.logo} alt="" className="h-10 w-10 object-contain" />
          )}
          {data.company.naziv && (
            <span className="text-lg font-semibold">{data.company.naziv}</span>
          )}
        </div>

        {/* Vehicle */}
        <h1 className="text-2xl font-bold mb-1">Servisna historija vozila</h1>
        <p className="text-lg">
          {data.vehicle.marka_vozila} {data.vehicle.model_vozila}
        </p>
        <p className="text-muted-foreground font-mono mb-8">
          {data.vehicle.registarske_tablice}
        </p>

        {/* Visits */}
        {data.visits.length === 0 ? (
          <p className="text-muted-foreground py-8">Nema zabilježenih servisa.</p>
        ) : (
          <div className="space-y-6">
            {data.visits.map((v, i) => (
              <div key={i} className="pb-6 border-b border-border last:border-0">
                <div className="flex items-baseline justify-between mb-1">
                  <span className="font-semibold">{formatDate(v.datum)}</span>
                  {v.kilometraza != null && (
                    <span className="text-sm text-muted-foreground">
                      {v.kilometraza.toLocaleString("de-DE")} km
                    </span>
                  )}
                </div>
                {v.opis_kvara && <p className="text-sm mb-2">{v.opis_kvara}</p>}
                {v.items.length > 0 && (
                  <ul className="text-sm text-muted-foreground space-y-0.5">
                    {v.items.map((it, j) => (
                      <li key={j}>
                        {it.tip === "dio" ? "Dio" : "Usluga"}: {it.naziv}
                        {it.kolicina > 1 ? ` ×${it.kolicina}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
                {v.mehanicar && (
                  <p className="text-xs text-muted-foreground mt-2">Mehaničar: {v.mehanicar}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
