"use client";

import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Camera, Check, ChevronDown, CircleAlert, Download, FileCheck2, Files, FileText, FolderOpen, LayoutDashboard, Loader2, Menu, Pencil, Plus, ReceiptText, Search, Settings, Sparkles, TableProperties, Trash2, UploadCloud, WalletCards, X } from "lucide-react";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { extractInvoiceFields } from "./invoice-parser";

type Kind = "invoice" | "expense";
type Status = "paid" | "pending" | "overdue" | "draft";
type TaxLine = { rate: number; netCents: number; taxCents: number };
type TaxLineDraft = { rate: number; net: string; tax: string };
type RecordItem = { id: number; kind: Kind; number: string; party: string; concept: string; issueDate: string; dueDate: string | null; paymentDate?: string | null; paymentMethod?: string | null; netCents: number; taxCents: number; totalCents: number; taxRate: number; taxBreakdown?: TaxLine[]; status: Status; fileName?: string | null; fileType?: string | null; createdAt: string };
const money = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const dateFmt = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" });
const quarterKey = (date:string) => { const [year,month]=date.split("-").map(Number); return `${year}-T${Math.floor((month-1)/3)+1}`; };
const seedRecords: RecordItem[] = [
  { id: -1, kind: "invoice", number: "F-2026-014", party: "Estudio Norte S.L.", concept: "Diseño de identidad", issueDate: "2026-09-12", dueDate: "2026-10-12", netCents: 240000, taxCents: 50400, totalCents: 290400, taxRate: 21, status: "pending", createdAt: "" },
  { id: -2, kind: "expense", number: "G-0926-08", party: "Adobe Systems", concept: "Software mensual", issueDate: "2026-09-08", dueDate: null, netCents: 5999, taxCents: 1260, totalCents: 7259, taxRate: 21, status: "paid", createdAt: "" },
  { id: -3, kind: "invoice", number: "F-2026-013", party: "Café Atlántico", concept: "Campaña de lanzamiento", issueDate: "2026-09-01", dueDate: "2026-09-15", netCents: 120000, taxCents: 25200, totalCents: 145200, taxRate: 21, status: "overdue", createdAt: "" },
  { id: -4, kind: "expense", number: "T-88421", party: "Renfe", concept: "Viaje a cliente", issueDate: "2026-08-29", dueDate: null, netCents: 8420, taxCents: 842, totalCents: 9262, taxRate: 10, status: "paid", createdAt: "" },
];

function StatusBadge({ status }: { status: Status }) {
  const labels = { paid: "Pagada", pending: "Pendiente", overdue: "Vencida", draft:"Por revisar" };
  return <span className={`status ${status}`}><span />{labels[status]}</span>;
}

function TaxBreakdownEditor({ lines, onChange }: { lines:TaxLineDraft[]; onChange:(lines:TaxLineDraft[])=>void }) {
  const update=(index:number,key:keyof TaxLineDraft,value:string|number)=>onChange(lines.map((line,i)=>i===index?{...line,[key]:value}:line));
  return <div className="tax-breakdown wide"><div className="tax-breakdown-head"><span>Desglose de IVA</span><button type="button" onClick={()=>onChange([...lines,{rate:21,net:"",tax:""}])}><Plus/>Añadir IVA</button></div>{lines.map((line,index)=><div className="tax-line" key={index}><label>Tipo<select value={line.rate} onChange={e=>update(index,"rate",Number(e.target.value))}><option value="21">21%</option><option value="10">10%</option><option value="4">4%</option><option value="0">0%</option></select></label><label>Base imponible (€)<input type="number" min="0" step="0.01" required value={line.net} onChange={e=>update(index,"net",e.target.value)}/></label><label>IVA (€)<input type="number" min="0" step="0.01" required value={line.tax} onChange={e=>update(index,"tax",e.target.value)}/></label><button type="button" className="remove-tax" aria-label="Eliminar tipo de IVA" disabled={lines.length===1} onClick={()=>onChange(lines.filter((_,i)=>i!==index))}><Trash2/></button></div>)}</div>;
}

export default function Dashboard({ initialRecords }: { initialRecords: RecordItem[] }) {
  const [records, setRecords] = useState(initialRecords.length ? initialRecords : seedRecords);
  const [tab, setTab] = useState<"all" | Kind | "draft">("all");
  const [folder, setFolder] = useState("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [scanMode, setScanMode] = useState(false);
  const [selected, setSelected] = useState<RecordItem | null>(null);
  const [editing, setEditing] = useState<RecordItem | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState("");
  const [taxMode, setTaxMode] = useState(21);
  const [taxLines, setTaxLines] = useState<TaxLineDraft[]>([{rate:21,net:"",tax:""}]);
  const [editTaxMode, setEditTaxMode] = useState(21);
  const [editTaxLines, setEditTaxLines] = useState<TaxLineDraft[]>([{rate:21,net:"",tax:""}]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchSaving, setBatchSaving] = useState(false);
  const [newStatus, setNewStatus] = useState<Status>("pending");
  const [editStatus, setEditStatus] = useState<Status>("pending");
  const [section, setSection] = useState<"dashboard"|"ledger"|"pendingLedger">("dashboard");
  const [selectedLedger, setSelectedLedger] = useState<Set<number>>(new Set());
  const formRef = useRef<HTMLFormElement>(null);
  const realData = initialRecords.length > 0;
  const quarterFolders = useMemo(() => [...new Set(records.filter(r=>r.id>0).map(r=>quarterKey(r.issueDate)))].sort().reverse(), [records]);
  const providers = useMemo(() => [...new Set(records.filter(r=>r.id>0).map(r=>r.party.trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"es")), [records]);
  const filtered = useMemo(() => records.filter(r => (folder === "all" || quarterKey(r.issueDate) === folder) && (tab === "draft" ? r.status === "draft" : tab === "all" || r.kind === tab) && `${r.number} ${r.party} ${r.fileName || ""}`.toLowerCase().includes(query.toLowerCase())), [records, folder, tab, query]);
  const payable = useMemo(()=>records.filter(r=>r.kind==="expense"&&(r.status==="pending"||r.status==="overdue")),[records]);
  const totals = useMemo(() => ({
    spent: records.filter(r => r.kind === "expense").reduce((a, r) => a + r.totalCents, 0),
    tax: records.reduce((a, r) => a + Math.abs(r.taxCents), 0),
    pending: records.filter(r => r.kind === "expense" && (r.status === "pending" || r.status === "overdue")).reduce((a, r) => a + r.totalCents, 0),
  }), [records]);
  const selectedLedgerTotal=useMemo(()=>records.filter(record=>selectedLedger.has(record.id)).reduce((sum,record)=>sum+record.totalCents,0),[records,selectedLedger]);

  async function updateLedger(record:RecordItem,changes:Partial<RecordItem>){
    const next={...record,...changes};
    if(changes.netCents!==undefined||changes.taxCents!==undefined)next.totalCents=next.netCents+next.taxCents;
    try{const response=await fetch(`/api/documents/${record.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(next)});if(!response.ok)throw new Error();const updated=await response.json();setRecords(previous=>previous.map(item=>item.id===updated.id?updated:item));setNotice("Cambio guardado");setTimeout(()=>setNotice(""),1800);}catch{setNotice("No se pudo guardar el cambio");setTimeout(()=>setNotice(""),3000);}
  }

  async function saveBatch() {
    if(!batchFiles.length)return;
    setBatchSaving(true);
    const payload=new FormData();batchFiles.forEach(item=>payload.append("files",item));
    try {const response=await fetch("/api/documents/drafts",{method:"POST",body:payload});if(!response.ok)throw new Error();const created=await response.json();setRecords(previous=>[...created,...previous.filter(record=>record.id>0)]);setBatchOpen(false);setBatchFiles([]);setTab("draft");setFolder("all");setNotice(`${created.length} ${created.length===1?"factura guardada":"facturas guardadas"} para revisar más tarde`);setTimeout(()=>setNotice(""),4000);} catch {setNotice("No se pudo guardar el lote. Revisa los archivos e inténtalo de nuevo.");setTimeout(()=>setNotice(""),4500);} finally {setBatchSaving(false);}
  }

  useEffect(()=>()=>{if(previewUrl)URL.revokeObjectURL(previewUrl)},[previewUrl]);
  useEffect(()=>{if(editing)setEditStatus(editing.status==="draft"?"pending":editing.status)},[editing]);

  async function submitRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true);
    const formData = new FormData(event.currentTarget);
    const data = Object.fromEntries(formData);
    const taxRate = Number(data.taxRate);
    const breakdown = taxRate===-1 ? taxLines.map(line=>({rate:line.rate,netCents:Math.round(Number(line.net)*100),taxCents:Math.round(Number(line.tax)*100)})).filter(line=>Number.isInteger(line.netCents)&&line.netCents>=0&&Number.isInteger(line.taxCents)&&line.taxCents>=0) : [];
    const net = taxRate===-1 ? breakdown.reduce((sum,line)=>sum+line.netCents,0) : Math.round(Number(data.net) * 100);
    const hasSuppliedTax = String(data.taxAmount || "").trim() !== "", hasSuppliedTotal = String(data.total || "").trim() !== "";
    const suppliedTax = Math.round(Number(data.taxAmount) * 100), suppliedTotal = Math.round(Number(data.total) * 100);
    const taxCents = taxRate===-1 ? breakdown.reduce((sum,line)=>sum+line.taxCents,0) : hasSuppliedTax && Number.isFinite(suppliedTax) && suppliedTax >= 0 ? suppliedTax : Math.round(net * Math.max(0, taxRate) / 100);
    const totalCents = taxRate===-1 ? net+taxCents : hasSuppliedTotal && Number.isFinite(suppliedTotal) && suppliedTotal > 0 ? suppliedTotal : net + taxCents;
    const draft = { ...data, netCents: net, taxRate, taxCents, totalCents, taxBreakdown:JSON.stringify(breakdown) };
    try {
      const payload = new FormData();
      Object.entries(draft).forEach(([key, value]) => payload.append(key, String(value)));
      if (file) payload.append("file", file);
      const response = await fetch("/api/documents", { method: "POST", body: payload });
      if (!response.ok) throw new Error();
      const created = await response.json();
      setRecords(prev => [created, ...prev.filter(r => r.id > 0)]); setNotice("Documento guardado");
    } catch {
      setSaving(false);
      setNotice("No se pudo guardar. Revisa el archivo e inténtalo de nuevo.");
      setTimeout(() => setNotice(""), 4000);
      return;
    }
    setSaving(false); setOpen(false); setFile(null); setPreviewUrl(""); setScanMode(false); setTimeout(() => setNotice(""), 3500);
  }

  async function deleteSelected() {
    if (!selected || selected.id < 0) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/documents/${selected.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      setRecords(previous => previous.filter(record => record.id !== selected.id));
      setSelected(null); setConfirmDelete(false); setNotice("Documento eliminado");
      setTimeout(() => setNotice(""), 3500);
    } catch {
      setNotice("No se pudo eliminar. Inténtalo de nuevo.");
      setTimeout(() => setNotice(""), 4000);
    } finally {
      setDeleting(false);
    }
  }

  async function updateRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setEditSaving(true);
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const taxRate = Number(data.taxRate);
    const taxBreakdown = taxRate===-1 ? editTaxLines.map(line=>({rate:line.rate,netCents:Math.round(Number(line.net)*100),taxCents:Math.round(Number(line.tax)*100)})).filter(line=>Number.isInteger(line.netCents)&&line.netCents>=0&&Number.isInteger(line.taxCents)&&line.taxCents>=0) : [];
    const netCents = taxRate===-1 ? taxBreakdown.reduce((sum,line)=>sum+line.netCents,0) : Math.round(Number(data.net) * 100);
    const taxCents = taxRate===-1 ? taxBreakdown.reduce((sum,line)=>sum+line.taxCents,0) : Math.round(Number(data.taxAmount) * 100), totalCents = taxRate===-1 ? netCents+taxBreakdown.reduce((sum,line)=>sum+line.taxCents,0) : Math.round(Number(data.total) * 100);
    try {
      const response = await fetch(`/api/documents/${editing.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...data, netCents, taxRate, taxCents, totalCents, taxBreakdown }),
      });
      if (!response.ok) throw new Error();
      const updated = await response.json();
      setRecords(previous => previous.map(record => record.id === updated.id ? updated : record));
      const nextDraft = editing.status==="draft" ? records.find(record=>record.status==="draft"&&record.id!==editing.id) : undefined;
      if(nextDraft){setEditing(nextDraft);setEditStatus("pending");setEditTaxMode(nextDraft.taxRate);setEditTaxLines(nextDraft.taxBreakdown?.length?nextDraft.taxBreakdown.map(line=>({rate:line.rate,net:(line.netCents/100).toFixed(2),tax:(line.taxCents/100).toFixed(2)})):[{rate:21,net:"",tax:""}]);setNotice("Guardado. Mostrando la siguiente factura por revisar.");}
      else {setEditing(null);setNotice("Documento actualizado");}
      setTimeout(() => setNotice(""), 3500);
    } catch {
      setNotice("No se pudo actualizar. Revisa los datos e inténtalo de nuevo.");
      setTimeout(() => setNotice(""), 4000);
    } finally {
      setEditSaving(false);
    }
  }

  function fillField(name:string,value:string){const field=formRef.current?.elements.namedItem(name) as HTMLInputElement|HTMLSelectElement|null;if(field&&value)field.value=value;}
  async function readInvoice(upload:File){
    setFile(upload);setPreviewUrl(URL.createObjectURL(upload));setScanning(true);setScanMessage("Preparando documento…");
    try{
      let extractedText="",visualText="",source:File|HTMLCanvasElement=upload,pdfPages=1;
      if(upload.type==="application/pdf"){
        setScanMessage("Leyendo el texto del PDF…");
        const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc=pdfWorkerUrl;
        const pdf=await pdfjs.getDocument({data:await upload.arrayBuffer()}).promise;
        pdfPages=pdf.numPages;
        const page=await pdf.getPage(1);
        const content=await page.getTextContent();
        extractedText=content.items.map(item=>"str" in item?item.str:"").filter(Boolean).join("\n");
        if(extractedText.length<100||/VERI\*?FACTU|QR\s+tributario|DOCUMENTO[\s\S]{0,80}N[ÚU]MERO[\s\S]{0,300}TIPO\s*%/i.test(extractedText)){
          const viewport=page.getViewport({scale:1.8}),canvas=document.createElement("canvas");
          canvas.width=viewport.width;canvas.height=viewport.height;
          await page.render({canvas,canvasContext:canvas.getContext("2d")!,viewport}).promise;source=canvas;
        }
      }
      if(!extractedText||source instanceof HTMLCanvasElement){
        setScanMessage("Reconociendo texto…");
        const{createWorker}=await import("tesseract.js");
        const worker=await createWorker(["spa","eng"],1,{logger:event=>{if(event.status==="recognizing text")setScanMessage(`Leyendo factura… ${Math.round((event.progress||0)*100)}%`);}});
        const result=await worker.recognize(source);await worker.terminate();
        if(extractedText)visualText=result.data.text;else extractedText=result.data.text;
      }
      const fields=extractInvoiceFields(extractedText,visualText);
      fillField("number",fields.number);fillField("issueDate",fields.issueDate);fillField("party",fields.party);
      setTaxMode(Number(fields.taxRate));
      if(fields.taxBreakdown.length>1)setTaxLines(fields.taxBreakdown.map(line=>({rate:line.rate,net:line.net,tax:line.tax})));
      fillField("net",fields.net||(fields.total?String((Number(fields.total)/(1+Number(fields.taxRate)/100)).toFixed(2)):""));fillField("taxRate",fields.taxRate);
      fillField("taxAmount",fields.taxAmount);fillField("total",fields.total);
      setScanMessage(fields.number&&fields.party&&(fields.net||fields.total)?(pdfPages>1?`Datos de la primera factura completados. El PDF contiene ${pdfPages} páginas.`:"Datos completados. Revisa y guarda."):"Lectura terminada. Revisa los campos.");
    }catch{setScanMessage("No se pudo leer automáticamente. Completa los datos manualmente.");}
    finally{setScanning(false);}
  }

  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool: (tool: unknown, options?: { signal: AbortSignal }) => void } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    context.registerTool({ name: "filter_documents", title: "Filtrar documentos", description: "Filtra la tabla visible por tipo y texto.", inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["all", "invoice", "expense"] }, query: { type: "string" } }, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute(input: unknown) { const v = input as { kind?: "all" | Kind; query?: string }; if (v.kind) setTab(v.kind); if (typeof v.query === "string") setQuery(v.query); return { filtered: true, kind: v.kind ?? tab, query: v.query ?? query }; } }, { signal: lifecycle.signal });
    return () => lifecycle.abort();
  }, [query, tab]);

  return <main className="app-shell">
    <aside className={`sidebar ${mobileNav ? "show" : ""}`}>
      <div className="brand"><div className="brand-mark">L</div><span>Lúmina</span><button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Cerrar menú"><X /></button></div>
      <nav aria-label="Navegación principal"><button className={section==="dashboard"?"active":""} onClick={()=>{setSection("dashboard");setTab("all");setMobileNav(false)}}><LayoutDashboard/>Resumen</button><button onClick={() => {setSection("dashboard");setTab("invoice");setMobileNav(false)}}><FileText />Facturas</button><button onClick={() => {setSection("dashboard");setTab("expense");setMobileNav(false)}}><ReceiptText />Gastos</button><button className={section==="ledger"?"active":""} onClick={()=>{setSection("ledger");setMobileNav(false)}}><TableProperties/>Facturas Excel</button><button className={section==="pendingLedger"?"active":""} onClick={()=>{setSection("pendingLedger");setMobileNav(false)}}><WalletCards/>Pagos pendientes Excel</button></nav>
      <div className="sidebar-bottom"><button><Settings />Configuración</button><div className="profile"><div>V</div><span><strong>Venice</strong><small>Empresa</small></span><ChevronDown /></div></div>
    </aside>
    <section className="workspace" id="inicio">
      <header className="topbar"><button className="menu-button" onClick={() => setMobileNav(true)} aria-label="Abrir menú"><Menu /></button><div><p>Gestión de facturas</p><h1>Venice</h1></div><div className="top-actions"><button className="batch-button" onClick={()=>{setBatchFiles([]);setBatchOpen(true)}}><Files/>Subir varias</button><button className="primary-button" onClick={() => {setTaxMode(21);setTaxLines([{rate:21,net:"",tax:""}]);setNewStatus("pending");setScanMode(true);setOpen(true)}}><Camera />Subir factura</button></div></header>
      <div className={`content view-${section}`}>
        {!realData && <div className="demo-note"><CircleAlert /> Estás viendo datos de ejemplo. Añade tu primer documento para empezar.</div>}
        <section className="metric-grid" aria-label="Resumen financiero">
          <article><div className="metric-icon rose"><ArrowDownLeft /></div><p>Gastos</p><strong>{money.format(totals.spent / 100)}</strong><small>Deducibles registrados</small></article>
          <article><div className="metric-icon amber"><WalletCards /></div><p>IVA estimado</p><strong>{money.format(totals.tax / 100)}</strong><small>A reservar</small></article>
          <article className="dark-card"><p>Pendiente de pago</p><strong>{money.format(totals.pending / 100)}</strong><small>{payable.length} {payable.length===1?"factura pendiente":"facturas pendientes"}</small></article>
        </section>
        <section className="pending-payments"><div className="pending-head"><div><h2>Facturas pendientes de pago</h2><p>Gastos recibidos que todavía no se han pagado.</p></div><a href="/api/export?pending=1"><Download/>Exportar pagos pendientes</a></div>{payable.length?<div className="pending-list">{payable.slice(0,6).map(item=><button key={item.id} onClick={()=>setSelected(item)}><span><strong>{item.party}</strong><small>{item.number} · vence {item.dueDate?dateFmt.format(new Date(`${item.dueDate}T12:00:00`)):"sin fecha"}</small></span><b>{money.format(item.totalCents/100)}</b></button>)}</div>:<div className="pending-empty"><Check/>No hay facturas pendientes de pago.</div>}</section>
        <section className="quarter-section" aria-label="Carpetas trimestrales"><div className="quarter-heading"><div><h2>Carpetas por trimestre</h2><p>Las facturas se archivan automáticamente según su fecha.</p></div><div className="quarter-actions"><button className={folder==="all"?"active":""} onClick={()=>setFolder("all")}><FolderOpen/>Todas</button><a href={`/api/export?quarter=${encodeURIComponent(folder)}`}><Download/>Exportar Excel</a></div></div><div className="quarter-folders">{quarterFolders.map(key=>{const items=records.filter(r=>r.id>0&&quarterKey(r.issueDate)===key);const total=items.reduce((sum,item)=>sum+item.totalCents,0);const tax=items.reduce((sum,item)=>sum+Math.abs(item.taxCents),0);return <button key={key} className={folder===key?"active":""} onClick={()=>setFolder(key)}><FolderOpen/><span><strong>{key.replace("-"," ")}</strong><small>{items.length} {items.length===1?"documento":"documentos"}</small></span><b><span>{money.format(total/100)}</span><small>IVA {money.format(tax/100)}</small></b></button>})}{!quarterFolders.length&&<div className="folder-empty">Las carpetas aparecerán al guardar tu primera factura.</div>}</div></section>
        <section className="documents-card">
          <div className="card-head"><div><h2>Documentos</h2><p>Facturas emitidas y gastos recibidos</p></div><div className="search"><Search /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar documento..." aria-label="Buscar documentos" /></div></div>
          <div className="tabs" role="tablist">{([['all','Todos'],['draft',`Por revisar (${records.filter(r=>r.status==="draft").length})`],['invoice','Facturas'],['expense','Gastos']] as const).map(([key,label]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</div>
          <div className="table-wrap"><table><thead><tr><th>Documento</th><th>Cliente / Proveedor</th><th>Fecha</th><th>Estado</th><th className="right">Total</th></tr></thead><tbody>{filtered.map(r => <tr key={r.id} className="clickable-row" tabIndex={0} onClick={() => setSelected(r)} onKeyDown={e => {if(e.key === "Enter" || e.key === " ") setSelected(r)}}><td><div className={`doc-icon ${r.kind}`}>{r.fileName ? <FileCheck2 /> : <FileText />}</div><span><strong>{r.number}</strong><small>{r.fileName || "Sin archivo adjunto"}</small></span></td><td>{r.party}</td><td>{dateFmt.format(new Date(`${r.issueDate}T12:00:00`))}</td><td><StatusBadge status={r.status} /></td><td className="right amount">{money.format(r.totalCents/100)}</td></tr>)}</tbody></table>{!filtered.length && <div className="empty"><ReceiptText /><strong>No hay documentos</strong><span>Prueba otra búsqueda o añade uno nuevo.</span></div>}</div>
        </section>
        <section className="ledger-card"><div className="ledger-head"><div><h2>Facturas Excel</h2><p>Edita las celdas y selecciona facturas para sumar sus importes.</p></div><div className="ledger-actions"><div className="selected-total"><small>{selectedLedger.size} seleccionadas</small><strong>{money.format(selectedLedgerTotal/100)}</strong></div><a href={`/api/export?quarter=${encodeURIComponent(folder)}`}><Download/>Descargar Excel</a></div></div><div className="ledger-wrap"><table><thead><tr><th className="check-col">✓</th><th>Fecha de factura</th><th>Factura</th><th>Estado de pago</th><th>Fecha de pago</th><th>Método de pago</th><th>Debe</th><th>Haber</th><th>IVA</th><th>Base impon.</th></tr></thead><tbody>{[...new Set(records.filter(r=>r.id>0&&r.status!=="draft"&&(folder==="all"||quarterKey(r.issueDate)===folder)).map(r=>r.party))].map(party=><Fragment key={party}><tr className="ledger-account"><td colSpan={10}>CUENTA: {party}</td></tr>{records.filter(r=>r.id>0&&r.status!=="draft"&&r.party===party&&(folder==="all"||quarterKey(r.issueDate)===folder)).map(item=><tr key={item.id} className={selectedLedger.has(item.id)?"selected-row":""}><td className="check-col"><input type="checkbox" checked={selectedLedger.has(item.id)} onChange={e=>setSelectedLedger(previous=>{const next=new Set(previous);e.target.checked?next.add(item.id):next.delete(item.id);return next})}/></td><td><input type="date" defaultValue={item.issueDate} onBlur={e=>void updateLedger(item,{issueDate:e.target.value})}/></td><td><input defaultValue={item.number} onBlur={e=>void updateLedger(item,{number:e.target.value})}/></td><td><select value={item.status} onChange={e=>void updateLedger(item,{status:e.target.value as Status})}><option value="pending">Pendiente</option><option value="paid">Pagado</option><option value="overdue">Vencido</option></select></td><td><input type="date" defaultValue={item.paymentDate||""} onBlur={e=>void updateLedger(item,{paymentDate:e.target.value||null})}/></td><td><select value={item.paymentMethod||""} onChange={e=>void updateLedger(item,{paymentMethod:e.target.value||null})}><option value=""></option><option value="Transferencia">Transferencia</option><option value="Tarjeta">Tarjeta</option><option value="Efectivo">Efectivo</option><option value="Domiciliación bancaria">Domiciliación</option><option value="Cheque">Cheque</option><option value="Otro">Otro</option></select></td><td className="num">{item.kind==="expense"?money.format(item.totalCents/100):""}</td><td className="num">{item.kind==="invoice"?money.format(item.totalCents/100):""}</td><td className="num vat-cell"><input type="number" min="0" step="0.01" defaultValue={(item.taxCents/100).toFixed(2)} onBlur={e=>void updateLedger(item,{taxCents:Math.round(Number(e.target.value)*100)})}/></td><td className="num base-cell"><input type="number" min="0" step="0.01" defaultValue={(item.netCents/100).toFixed(2)} onBlur={e=>void updateLedger(item,{netCents:Math.round(Number(e.target.value)*100)})}/></td></tr>)}</Fragment>)}</tbody></table>{!records.some(r=>r.id>0&&r.status!=="draft")&&<div className="ledger-empty">La vista se completará al guardar tu primera factura.</div>}</div></section>
        <section className="pending-ledger-card"><div className="ledger-head"><div><h2>Pagos pendientes Excel</h2><p>Facturas recibidas que todavía están pendientes de pago.</p></div><div className="ledger-actions"><div className="selected-total"><small>{selectedLedger.size} seleccionadas</small><strong>{money.format(selectedLedgerTotal/100)}</strong></div><a href="/api/export?pending=1"><Download/>Descargar Excel</a></div></div><div className="ledger-wrap"><table><thead><tr><th className="check-col">✓</th><th>Proveedor</th><th>Fecha de factura</th><th>Factura</th><th>Vencimiento</th><th>Estado</th><th>Total</th></tr></thead><tbody>{payable.map(item=><tr key={item.id} className={selectedLedger.has(item.id)?"selected-row":""}><td className="check-col"><input type="checkbox" checked={selectedLedger.has(item.id)} onChange={e=>setSelectedLedger(previous=>{const next=new Set(previous);e.target.checked?next.add(item.id):next.delete(item.id);return next})}/></td><td><input defaultValue={item.party} onBlur={e=>void updateLedger(item,{party:e.target.value})}/></td><td><input type="date" defaultValue={item.issueDate} onBlur={e=>void updateLedger(item,{issueDate:e.target.value})}/></td><td><input defaultValue={item.number} onBlur={e=>void updateLedger(item,{number:e.target.value})}/></td><td><input type="date" defaultValue={item.dueDate||""} onBlur={e=>void updateLedger(item,{dueDate:e.target.value||null})}/></td><td><select value={item.status} onChange={e=>void updateLedger(item,{status:e.target.value as Status})}><option value="pending">Pendiente</option><option value="paid">Pagado</option><option value="overdue">Vencido</option></select></td><td className="num"><strong>{money.format(item.totalCents/100)}</strong></td></tr>)}</tbody></table>{!payable.length&&<div className="ledger-empty">No hay pagos pendientes.</div>}</div></section>
      </div>
    </section>
    {open && <div className="modal-backdrop" role="presentation" onMouseDown={e => {if(e.target === e.currentTarget){setOpen(false);setFile(null);setPreviewUrl("")}}}><section className={`modal ${scanMode&&file?"review-modal":""}`} role="dialog" aria-modal="true" aria-labelledby="new-title"><div className="modal-head"><div><h2 id="new-title">{scanMode ? (file?"Revisar factura":"Escanear o subir factura") : "Nuevo documento"}</h2><p>{scanMode ? (file?"Comprueba el documento a la izquierda y corrige cualquier campo antes de guardar.":"La lectura ocurre en tu navegador. Revisa y guarda.") : "Registra una factura o un gasto."}</p></div><button onClick={() => {setOpen(false);setFile(null);setPreviewUrl("")}} aria-label="Cerrar"><X /></button></div><form ref={formRef} onSubmit={submitRecord}>
      {scanMode&&file&&previewUrl&&<div className="review-preview">{file.type==="application/pdf"?<iframe src={previewUrl} title={`Vista previa de ${file.name}`}/>:<img src={previewUrl} alt={`Vista previa de ${file.name}`}/>}</div>}
      {scanMode && <><label className={`upload-zone ${file ? "has-file" : ""}`}><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" required onChange={e => {const next=e.target.files?.[0];if(next)void readInvoice(next)}} />{scanning ? <><Loader2 className="spin" /><strong>{scanMessage}</strong><span>No cierres esta ventana</span></> : file ? <><FileCheck2 /><strong>{file.name}</strong><span>{(file.size/1024/1024).toFixed(1)} MB · Pulsa para cambiar</span></> : <><UploadCloud /><strong>Haz una foto o selecciona un archivo</strong><span>JPG, PNG, WebP o PDF · máximo 10 MB</span></>}</label>{file&&<div className={`scan-result ${scanning?"working":""}`}><Sparkles />{scanMessage}</div>}</>}
      <div className="kind-toggle"><label><input type="radio" name="kind" value="invoice" /><span><ArrowUpRight />Factura emitida</span></label><label><input type="radio" name="kind" value="expense" defaultChecked /><span><ArrowDownLeft />Gasto recibido</span></label></div>
      <div className="form-grid"><label>Número<input name="number" required placeholder="F-2026-015" /></label><label>Fecha de factura<input name="issueDate" type="date" required defaultValue="2026-09-17" /></label><label className="wide">Cliente o proveedor<input name="party" list="saved-providers" required placeholder="Escribe o elige un proveedor guardado" /></label><label>Tipo de IVA<select name="taxRate" value={taxMode} onChange={e=>setTaxMode(Number(e.target.value))}><option value="21">21%</option><option value="10">10%</option><option value="4">4%</option><option value="0">0%</option><option value="-1">Varios tipos</option></select></label>{taxMode===-1?<TaxBreakdownEditor lines={taxLines} onChange={setTaxLines}/>:<><label>Base imponible (€)<input name="net" type="number" min="0.01" step="0.01" required placeholder="0,00" /></label><label>IVA (€)<input name="taxAmount" type="number" min="0" step="0.01" placeholder="Se calcula automáticamente" /></label></>}<label>Total (€)<input name="total" type="number" min="0.01" step="0.01" placeholder="Se calcula automáticamente" /></label><label>Estado<select name="status" value={newStatus} onChange={e=>setNewStatus(e.target.value as Status)}><option value="pending">Pendiente</option><option value="paid">Pagada</option><option value="overdue">Vencida</option></select></label><label>Vencimiento<input name="dueDate" type="date" /></label>{newStatus==="paid"&&<><label>Fecha de pago<input name="paymentDate" type="date" required /></label><label>Método de pago<select name="paymentMethod" required><option value="">Selecciona</option><option value="Transferencia">Transferencia</option><option value="Tarjeta">Tarjeta</option><option value="Efectivo">Efectivo</option><option value="Domiciliación bancaria">Domiciliación bancaria</option><option value="Cheque">Cheque</option><option value="Otro">Otro</option></select></label></>}</div>
      <footer><button type="button" className="secondary-button" onClick={() => {setOpen(false);setFile(null);setPreviewUrl("")}}>Cancelar</button><button className="primary-button" disabled={saving||scanning}>{saving ? "Guardando..." : <><Check />Revisado y guardar</>}</button></footer>
    </form></section></div>}
    {editing && <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!editSaving)setEditing(null)}}><section className="modal edit-review-modal" role="dialog" aria-modal="true" aria-labelledby="edit-title"><div className="modal-head"><div><h2 id="edit-title">Editar documento</h2><p>Completa los datos mientras consultas la factura original.</p></div><button onClick={()=>setEditing(null)} disabled={editSaving} aria-label="Cerrar edición"><X/></button></div><form key={editing.id} onSubmit={updateRecord}>
      <div className="edit-fields">
      <input type="hidden" name="kind" value={editing.kind}/>
      <div className="form-grid"><label>Número<input name="number" required defaultValue={editing.status==="draft"?"":editing.number}/></label><label>Fecha de factura<input name="issueDate" type="date" required defaultValue={editing.issueDate}/></label><label className="wide provider-edit-field">Cliente o proveedor<input name="party" list="saved-providers" required defaultValue={editing.status==="draft"?"":editing.party}/><button type="button" onClick={event=>{const input=event.currentTarget.previousElementSibling as HTMLInputElement|null;if(input){input.value="";input.focus()}}}><Trash2/>Quitar proveedor</button></label><label>Tipo de IVA<select name="taxRate" value={editTaxMode} onChange={e=>setEditTaxMode(Number(e.target.value))}><option value="21">21%</option><option value="10">10%</option><option value="4">4%</option><option value="0">0%</option><option value="-1">Varios tipos</option></select></label>{editTaxMode===-1?<TaxBreakdownEditor lines={editTaxLines} onChange={setEditTaxLines}/>:<><label>Base imponible (€)<input name="net" type="number" min="0.01" step="0.01" required defaultValue={editing.netCents?(editing.netCents/100).toFixed(2):""}/></label><label>IVA (€)<input name="taxAmount" type="number" min="0" step="0.01" required defaultValue={editing.taxCents?(editing.taxCents/100).toFixed(2):""}/></label></>}<label>Total (€)<input name="total" type="number" min="0.01" step="0.01" required defaultValue={editing.totalCents?(editing.totalCents/100).toFixed(2):""}/></label><label>Estado<select name="status" value={editStatus} onChange={e=>setEditStatus(e.target.value as Status)}><option value="pending">Pendiente</option><option value="paid">Pagada</option><option value="overdue">Vencida</option></select></label><label>Vencimiento<input name="dueDate" type="date" defaultValue={editing.dueDate||""}/></label>{editStatus==="paid"&&<><label>Fecha de pago<input name="paymentDate" type="date" required defaultValue={editing.paymentDate||""}/></label><label>Método de pago<select name="paymentMethod" required defaultValue={editing.paymentMethod||""}><option value="">Selecciona</option><option value="Transferencia">Transferencia</option><option value="Tarjeta">Tarjeta</option><option value="Efectivo">Efectivo</option><option value="Domiciliación bancaria">Domiciliación bancaria</option><option value="Cheque">Cheque</option><option value="Otro">Otro</option></select></label></>}</div>
      <footer><button type="button" className="secondary-button" onClick={()=>setEditing(null)} disabled={editSaving}>Cancelar</button><button className="primary-button" disabled={editSaving}>{editSaving?<><Loader2 className="spin"/>Guardando…</>:<><Check/>{editing.status==="draft"&&records.some(r=>r.status==="draft"&&r.id!==editing.id)?"Guardar y siguiente":"Guardar cambios"}</>}</button></footer></div>
      <div className="edit-preview">{editing.fileName?(editing.fileType==="application/pdf"?<iframe src={`/api/documents/${editing.id}/file`} title={`Factura ${editing.number}`}/>:<img src={`/api/documents/${editing.id}/file`} alt={`Documento ${editing.number}`}/>):<div className="no-preview"><FileText/><strong>Sin archivo adjunto</strong></div>}</div>
    </form></section></div>}
    {batchOpen&&<div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!batchSaving)setBatchOpen(false)}}><section className="modal batch-modal" role="dialog" aria-modal="true" aria-labelledby="batch-title"><div className="modal-head"><div><h2 id="batch-title">Subir facturas para revisar después</h2><p>Guarda hasta 10 facturas ahora y completa sus datos cuando tengas tiempo.</p></div><button onClick={()=>setBatchOpen(false)} disabled={batchSaving} aria-label="Cerrar"><X/></button></div><label className={`upload-zone ${batchFiles.length?"has-file":""}`}><input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e=>setBatchFiles(Array.from(e.target.files||[]).slice(0,10))}/><UploadCloud/><strong>{batchFiles.length?`${batchFiles.length} ${batchFiles.length===1?"archivo seleccionado":"archivos seleccionados"}`:"Selecciona varias facturas"}</strong><span>JPG, PNG, WebP o PDF · hasta 10 archivos</span></label>{batchFiles.length>0&&<div className="batch-list">{batchFiles.map((item,index)=><div key={`${item.name}-${index}`}><FileCheck2/><span><strong>{item.name}</strong><small>{(item.size/1024/1024).toFixed(1)} MB</small></span><button type="button" onClick={()=>setBatchFiles(files=>files.filter((_,i)=>i!==index))} aria-label={`Quitar ${item.name}`}><X/></button></div>)}</div>}<footer><button type="button" className="secondary-button" onClick={()=>setBatchOpen(false)} disabled={batchSaving}>Cancelar</button><button type="button" className="primary-button" onClick={()=>void saveBatch()} disabled={!batchFiles.length||batchSaving}>{batchSaving?<><Loader2 className="spin"/>Guardando…</>:<><Check/>Guardar para después</>}</button></footer></section></div>}
    {selected && <div className="modal-backdrop" role="presentation" onMouseDown={e => {if(e.target === e.currentTarget&&!deleting){setSelected(null);setConfirmDelete(false)}}}><section className="invoice-viewer" role="dialog" aria-modal="true" aria-labelledby="invoice-title">
      <header><div><small>{selected.kind === "invoice" ? "Factura emitida" : "Gasto recibido"}</small><h2 id="invoice-title">{selected.number}</h2><p>{selected.party}</p></div><button onClick={() => {setSelected(null);setConfirmDelete(false)}} disabled={deleting} aria-label="Cerrar factura"><X /></button></header>
      <div className="viewer-body">
        <div className="document-preview">{selected.fileName ? (selected.fileType === "application/pdf" ? <iframe src={`/api/documents/${selected.id}/file`} title={`Factura ${selected.number}`} /> : <img src={`/api/documents/${selected.id}/file`} alt={`Documento ${selected.number}`} />) : <div className="no-preview"><FileText /><strong>Sin archivo adjunto</strong><span>Este registro se creó manualmente.</span></div>}</div>
        <aside className="invoice-details"><h3>Datos de la factura</h3><dl><div><dt>Fecha de factura</dt><dd>{dateFmt.format(new Date(`${selected.issueDate}T12:00:00`))}</dd></div><div><dt>Base imponible</dt><dd>{money.format(selected.netCents/100)}</dd></div>{selected.taxRate===-1&&selected.taxBreakdown?.length?selected.taxBreakdown.map((line,index)=><div key={index}><dt>IVA {line.rate}% · Base {money.format(line.netCents/100)}</dt><dd>{money.format(line.taxCents/100)}</dd></div>):<div><dt>{`IVA (${selected.taxRate}%)`}</dt><dd>{money.format(Math.abs(selected.taxCents)/100)}</dd></div>}<div className="total-line"><dt>Total</dt><dd>{money.format(selected.totalCents/100)}</dd></div></dl><StatusBadge status={selected.status} />{selected.id>0&&<button type="button" className="edit-button" onClick={()=>{setEditTaxMode(selected.taxRate);setEditTaxLines(selected.taxBreakdown?.length?selected.taxBreakdown.map(line=>({rate:line.rate,net:(line.netCents/100).toFixed(2),tax:(line.taxCents/100).toFixed(2)})):[{rate:21,net:(selected.netCents/100).toFixed(2),tax:(selected.taxCents/100).toFixed(2)}]);setEditing(selected);setSelected(null);setConfirmDelete(false)}}><Pencil/>Editar documento</button>}{selected.fileName && <a className="download-link" href={`/api/documents/${selected.id}/file?download=1`}><FileCheck2 />Abrir archivo original</a>}{selected.id>0&&(confirmDelete?<div className="delete-confirm" role="alert"><strong>¿Eliminar este documento?</strong><span>También se borrará el archivo adjunto. Esta acción no se puede deshacer.</span><div><button type="button" onClick={()=>setConfirmDelete(false)} disabled={deleting}>Cancelar</button><button type="button" className="confirm-delete-button" onClick={()=>void deleteSelected()} disabled={deleting}>{deleting?<><Loader2 className="spin"/>Eliminando…</>:"Sí, eliminar"}</button></div></div>:<button type="button" className="delete-button" onClick={()=>setConfirmDelete(true)}><Trash2/>Eliminar documento</button>)}</aside>
      </div>
    </section></div>}
    <datalist id="saved-providers">{providers.map(provider=><option key={provider} value={provider}/>)}</datalist>
    {notice && <div className="toast"><Check />{notice}</div>}
  </main>;
}
