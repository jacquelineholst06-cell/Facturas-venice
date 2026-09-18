const parseEuro = (value?: string) => {
  if (!value) return "";
  const clean = value.replace(/[^\d,.-]/g, "");
  const number = Number(clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean);
  return Number.isFinite(number) ? number.toFixed(2) : "";
};

const toIsoDate = (value?: string) => {
  if (!value) return "";
  const [d, m, y] = value.split(/[\/.\-]/).map(Number);
  return d && m && y ? `${y < 100 ? 2000 + y : y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : "";
};

export function extractInvoiceFields(text: string, visualText = "") {
  const clean = text.replace(/\r/g, "");
  const visual = visualText.replace(/\r/g, "");
  const lines = clean.split("\n").map(x => x.trim()).filter(Boolean);
  const one = (r: RegExp) => clean.match(r)?.[1]?.trim();
  const visualOne = (r: RegExp) => visual.match(r)?.[1]?.trim();
  const factusolLine = visual.match(/\bFactura\s+(\d+\s+\d+)\s+\d+\s+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})/i);

  // PDF generators often emit values before their visual labels. Prefer the
  // explicit Spanish invoice marker and the starred document number first.
  const number = factusolLine?.[1]
    || visualOne(/N[º°O]\s*Factura[\s\S]{0,180}?\n\s*(\d{1,12})(?:\s+\d+){1,2}\b/i)
    || one(/\b(\d{6,12})\s*\n\s*N[º°O]\s*FACTURA\b/i)
    || one(/\*(\d{6,12})\*/)
    || one(/(?:factura|invoice|n[úu]mero|n[ºo°])\s*(?:de\s+factura)?\s*[:#.-]?\s*([A-Z0-9][A-Z0-9\/.\-]{2,})/i);

  const date = factusolLine?.[2]
    || one(/FECHA\s+FACTURA\s*\.?:\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i)
    || visualOne(/FECHA\s+FACTURA\s*\.?:\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i)
    || one(/\b(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})[\s\S]{0,80}?\bFECHA\b/i)
    || one(/(?:fecha(?:\s+de\s+emisi[oó]n)?|date)\s*[:.-]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i)
    || clean.match(/\b(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})\b/)?.[1];

  const taxTable = clean.match(/TOTAL\s+BASE[\s\S]{0,280}?\n\s*([\d.,]+)\s+(\d{1,2})\s+([\d.,]+)/i);
  const factusolTax = visual.match(/(?:^|\n)\s*(\d{1,2},\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s*$/m);
  const taxRows = [...clean.matchAll(/(?:^|\n)([\d.]+,\d{2})\s*\n\s*(\d{1,2}),\d\s*\n\s*([\d.]+,\d{2})\s*\n\s*0,0\s*\n\s*0,00\s*\n\s*(?:0,00|[\d.]+,\d{2})/g)];
  const summedBase = taxRows.reduce((sum, row) => sum + Number(parseEuro(row[1])), 0);
  const summedTax = taxRows.reduce((sum, row) => sum + Number(parseEuro(row[3])), 0);
  const mixedRates = new Set(taxRows.map(row => row[2])).size > 1;
  const base = taxRows.length ? String(summedBase.toFixed(2)) : factusolTax?.[3] || taxTable?.[1] || one(/(?:base\s+imponible|B\.I\.|subtotal|neto)\s*[:€]?\s*([\d.]+,\d{2}|[\d,]+\.\d{2})/i);
  const vat = mixedRates ? "-1" : taxRows[0]?.[2] || (factusolTax?.[1] ? String(Number(factusolTax[1].replace(",", "."))) : "") || taxTable?.[2] || clean.match(/(?:i\.?v\.?a\.?|vat)\s*(?:\(?\s*(\d{1,2})\s*%\s*\)?)?/i)?.[1] || "21";
  const totals = [...clean.matchAll(/(?:total(?:\s+(?:factura|importe))?|importe\s+total)\s*[:€]?\s*([\d.]+,\d{2}|[\d,]+\.\d{2})/gi)];
  const statedTotal = visualOne(/TOTAL\s*:\s*([\d.]+,\d{2})/i) || one(/IMPORTES\s*(?:\.\s*)*:?[\s\n]*([\d.]+,\d{2})/i) || totals.at(-1)?.[1];

  // The issuer is normally printed in the footer/header; the recipient can
  // also look like a company, so use the final legal company name in the PDF.
  const companyPattern = /([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 ,.\-&]+(?:S\.?A\.?L\.?|S\.?A\.?U\.?|S\.?L\.?U?\.?))/g;
  const visualHeader = visual.split(/N[º°O]\s*Factura|FECHA\s+FACTURA/i)[0];
  const visualHeaderLines = visualHeader.split("\n").map(line => line.trim()).filter(Boolean);
  const issuerTaxIndex = visualHeaderLines.findIndex(line => /^[A-Z8]-?\d{8}\b/i.test(line));
  const issuerCompanyLine = issuerTaxIndex > 0 ? visualHeaderLines.slice(Math.max(0,issuerTaxIndex-4),issuerTaxIndex).reverse().find(line=>/S\.?[AL]\.?/i.test(line)) : "";
  const issuerWithTaxId = issuerCompanyLine?.match(/([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 ,.\-&]+(?:S\.?A\.?L\.?|S\.?A\.?U\.?|S\.?L\.?U?\.?))/) || null;
  const visualCompanies = [...visualHeader.matchAll(companyPattern)];
  const companies = [...clean.matchAll(companyPattern)];
  const party = (issuerWithTaxId?.[1] || visualCompanies[0]?.[1])?.replace(/\s+,/g, ",").replace(/,(?=\S)/g, ", ").replace(/\bS\.A\.L$/, "S.A.L.").replace(/\bS\.L$/, "S.L.").trim()
    || companies.at(-1)?.[1]?.trim()
    || lines.find(x => x.length > 3 && x.length < 80 && !/factura|invoice|fecha|nif|cif|iva|total|www\.|@|p[aá]g/i.test(x))
    || "";
  const articleStart = lines.findIndex(x => /^ART[ÍI]CULO$/i.test(x));
  const paymentIndex = factusolLine ? lines.findIndex(x => /^TRANSF/i.test(x)) : -1;
  const itemStart = paymentIndex >= 0 ? paymentIndex : articleStart;
  const itemLines = itemStart >= 0 ? lines.slice(itemStart + 1, lines.findIndex((x, i) => i > itemStart && /^LIQUIDO$/i.test(x))) : lines;
  const productLineIndex = itemLines.findIndex((x, i) => /^(?:\d{4,12}|[A-Z]{2,5}\d{3,})$/i.test(x) && i + 1 < itemLines.length && /[A-ZÁÉÍÓÚÑ]/i.test(itemLines[i + 1]) && /\s/.test(itemLines[i + 1]));
  const firstDescription = productLineIndex >= 0 ? itemLines[productLineIndex + 1] : "";
  const secondDescription = productLineIndex >= 0 && /[A-ZÁÉÍÓÚÑ]/i.test(itemLines[productLineIndex + 2] || "") && !/^(?:\d|[A-Z]{2,5}\d{3,})/i.test(itemLines[productLineIndex + 2] || "") ? itemLines[productLineIndex + 2] : "";
  const concept = [firstDescription,secondDescription].filter(Boolean).join(" ")
    || lines.find(x => x.length > 10 && /\b(?:kg|ud|caja|servicio|producto)\b/i.test(x) && !/total|fecha/i.test(x))
    || "Factura importada";

  const parsedNet = parseEuro(base);
  const parsedTax = taxRows.length ? summedTax.toFixed(2) : parseEuro(factusolTax?.[4] || taxTable?.[3]);
  const parsedTotal = parseEuro(statedTotal) || (parsedNet && parsedTax ? (Number(parsedNet) + Number(parsedTax)).toFixed(2) : "");
  const taxBreakdown = taxRows.map(row => ({ rate:Number(row[2]), net:parseEuro(row[1]), tax:parseEuro(row[3]) }));
  return {
    number: number || "", issueDate: toIsoDate(date), party, concept,
    net: parsedNet, taxRate: vat, taxAmount: parsedTax,
    total: parsedTotal, mixedRates, taxBreakdown,
  };
}
