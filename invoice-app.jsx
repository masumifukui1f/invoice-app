import { useState, useEffect, useRef, useCallback } from "react";

// ============================================================
// FIREBASE CONFIG  ← ここにFirebaseの設定を貼り付けてください
// ============================================================
const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
};

// Firebase SDK を動的ロード（GitHub/本番環境用。デモ画面では無効）
const loadFirebase = (() => {
  let promise = null;
  return () => {
    if (promise) return promise;
    promise = new Promise((_resolve, reject) => {
      // デモ環境では Firebase を無効化
      reject(new Error("demo mode"));
    });
    return promise;
  };
})();

// Firestore CRUD ヘルパー
const COLLECTIONS = { docs: "docs", trash: "trash", masters: "masters" };

async function fbGetMasters(db) {
  const snap = await db.collection(COLLECTIONS.masters).get();
  const result = {};
  snap.forEach(d => { result[d.id] = d.data().value; });
  return result;
}
async function fbSetMaster(db, key, value) {
  await db.collection(COLLECTIONS.masters).doc(key).set({ value });
}
async function fbGetDocs(db, collName) {
  const snap = await db.collection(collName).orderBy("createdAt", "desc").get();
  return snap.docs.map(d => ({ ...d.data(), _fbId: d.id }));
}
async function fbSaveDoc(db, collName, doc) {
  const { _fbId, ...data } = doc;
  await db.collection(collName).doc(doc.id).set(data);
}
async function fbDeleteDoc(db, collName, id) {
  await db.collection(collName).doc(id).delete();
}
function fbSubscribe(db, collName, onChange) {
  return db.collection(collName)
    .orderBy("createdAt", "desc")
    .onSnapshot(snap => {
      onChange(snap.docs.map(d => ({ ...d.data(), _fbId: d.id })));
    });
}

// ============================================================
// INITIAL MASTER DATA
// ============================================================
const initialCompanies = [
  { id: 1, name: "株式会社サンプル商事", postal: "〒100-0001", address: "東京都千代田区千代田1-1-1", tel: "03-1234-5678", fax: "03-1234-5679", email: "info@sample-shoji.co.jp", bank: "〇〇銀行 △△支店 普通 1234567", invoiceNo: "T1234567890123" },
];
// 請求書用商品マスター（taxable: true=課税 / false=非課税）
const initialInvoiceProducts = [
  { id: 1, name: "Webサイト制作（基本）", price: 300000, taxable: true },
  { id: 2, name: "LP制作",               price: 150000, taxable: true },
  { id: 3, name: "保守・運用（月額）",   price:  30000, taxable: true },
  { id: 4, name: "デザイン修正",         price:   8000, taxable: true },
  { id: 5, name: "コーディング",         price:   7000, taxable: true },
];
// 見積書用商品マスター
const initialEstimateProducts = [
  { id: 1, name: "Webサイト制作（基本）", price: 300000, taxable: true },
  { id: 2, name: "LP制作",               price: 150000, taxable: true },
  { id: 3, name: "企画・提案費",          price:  50000, taxable: false },
  { id: 4, name: "コンサルティング",      price:  80000, taxable: false },
  { id: 5, name: "コーディング",          price:   7000, taxable: true },
];
const initialStaff = [
  { id: 1, name: "山田 太郎" },
  { id: 2, name: "佐藤 花子" },
  { id: 3, name: "鈴木 一郎" },
];
// 件名マスター（請求書・見積書 共通）
const initialSubjects = [
  { id: 1, text: "Webサイトリニューアル制作のご請求" },
  { id: 2, text: "ECサイト構築のご見積" },
  { id: 3, text: "保守・運用費用のご請求" },
  { id: 4, text: "システム開発費用のご請求" },
];
// 報告書用宛先マスター
const initialReportClients = [
  { id: 1, name: "株式会社サンプルパートナー" },
  { id: 2, name: "有限会社テストエージェント" },
];
// 報告書用件名マスター
const initialReportSubjects = [
  { id: 1, text: "2026年〇月度 リベート報告書（税有）" },
  { id: 2, text: "2026年〇月度 リベート報告書（税無）" },
];

const EMPTY_ITEM   = () => ({ name: "", qty: 1, price: 0 });
const BLANK_ITEMS  = () => Array.from({ length: 10 }, EMPTY_ITEM);

// 報告書用
const initialReferralItems = [
  { id: 1, text: "ウェディング紹介" },
  { id: 2, text: "会場コーディネート紹介" },
  { id: 3, text: "写真・映像紹介" },
  { id: 4, text: "装花・装飾紹介" },
];
const EMPTY_REPORT_ROW  = () => ({ workDate: "", user: "", referral: "", rebateRate: 0, chargeAmount: 0 });
const BLANK_REPORT_ROWS = () => Array.from({ length: 10 }, EMPTY_REPORT_ROW);
const ACCENT_RPT_TAX    = "#2d5a3d";   // 報告書（税有）深緑
const ACCENT_RPT_NOTAX  = "#4a3d7a";   // 報告書（税無）紫

// ============================================================
// HELPERS
// ============================================================
const fmt          = (n) => Number(n || 0).toLocaleString("ja-JP");
const today        = () => new Date().toISOString().slice(0, 10);
const ym           = (d) => d ? d.slice(0, 7) : "";
const ymLabel      = (s) => s ? s.replace("-", "年") + "月" : "";
const nextMonthEnd = () => { const d = new Date(); d.setMonth(d.getMonth() + 1); d.setDate(0); return d.toISOString().slice(0, 10); };
const genId        = () => Math.random().toString(36).slice(2, 9).toUpperCase();
const formatDocNumber = (type, docs) => {
  const prefix = type === "invoice" ? "INV" : type === "estimate" ? "EST" : type === "report_tax" ? "RPT" : "RPN";
  const count  = docs.filter((d) => d.type === type).length + 1;
  return `${prefix}-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2,"0")}-${String(count).padStart(4,"0")}`;
};

// ============================================================
// STORAGE
// ============================================================
const KEYS = {
  docs: "inv_docs4", companies: "inv_companies4",
  invProducts: "inv_invproducts4", estProducts: "inv_estproducts4",
  staff: "inv_staff4", subjects: "inv_subjects4", trash: "inv_trash4", referrals: "inv_referrals4", rptClients: "inv_rptclients4", rptSubjects: "inv_rptsubjects4",
};
const load    = (key, def) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; } };
const persist = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };

// ============================================================
// CALC（税込み金額のみ・税計算なし）
// ============================================================
// 明細1行の値引前金額（合計金額 amount があれば優先・後方互換）
function itemGross(item) {
  if (item.amount !== undefined && item.amount !== null && item.amount !== "") {
    return Number(item.amount);
  }
  return Number(item.qty || 0) * Number(item.price || 0);
}

// 明細1行の金額計算（gross=値引前, itemDiscount=この行の値引額, net=値引後）
function itemAmounts(item) {
  const gross = itemGross(item);
  let itemDiscount = 0;
  if (item.discountType === "%") {
    itemDiscount = Math.round(gross * (Number(item.discount || 0) / 100));
  } else if (item.discountType === "¥") {
    itemDiscount = Math.min(Number(item.discount || 0), gross);
  }
  if (itemDiscount < 0) itemDiscount = 0;
  return { gross, itemDiscount, net: gross - itemDiscount };
}

function calcTotals(form) {
  const isEstimate = form.type === "estimate";
  // 値引前の小計（各明細の値引前金額の合計）
  const subtotal = form.items.reduce((s, i) => s + itemGross(i), 0);

  let discountAmt;
  if (isEstimate) {
    // 見積書：商品ごとの値引きを合算
    discountAmt = form.items.reduce((s, i) => s + itemAmounts(i).itemDiscount, 0);
  } else {
    // 請求書：従来どおり全体の割引・値引き
    discountAmt = form.discountType === "%"
      ? Math.round(subtotal * (Number(form.discount || 0) / 100))
      : Math.min(Number(form.discount || 0), subtotal);
  }
  const total = subtotal - discountAmt;
  const partialPayment = Number(form.partialPayment || 0);
  const remaining      = total - partialPayment;
  // 互換性のため旧フィールド名も返す
  return { subtotal, discountAmt, total, partialPayment, remaining, isEstimate };
}

// ============================================================
// CALC REPORT（報告書用）
// ============================================================
function calcReport(items, type) {
  let totalCharge = 0;
  let totalRebate = 0;
  const rows = (items || []).map((item) => {
    const charge = Number(item.chargeAmount || 0);
    const rate   = Number(item.rebateRate   || 0);
    const rebate = Math.round(charge * rate / 100);
    totalCharge += charge;
    totalRebate += rebate;
    return { ...item, rebateAmount: rebate };
  });
  const rebateTax     = type === "report_tax" ? Math.round(totalRebate * 0.1) : 0;
  const rebateWithTax = totalRebate + rebateTax;
  return { rows, totalCharge, totalRebate, rebateTax, rebateWithTax };
}

// ============================================================
// EDIT LOG HELPERS
// ============================================================
const nowStr = () => {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};

const FIELD_LABELS = {
  type: "書類種別", docNumber: "書類番号", createdAt: "作成日", dueDate: "支払/見積期限",
  workDate: "施行日", clientName: "宛先", subject: "件名", note: "備考",
  specialNotes: "特記事項", staff: "担当者", discount: "割引値", discountType: "割引種別",
  partialPayment: "内入金済み",
};
const typeLabel = (v) => v === "invoice" ? "請求書" : v === "estimate" ? "見積書" : v;

function detectChanges(prev, next) {
  const changes = [];
  // スカラーフィールド
  for (const key of Object.keys(FIELD_LABELS)) {
    const pv = String(prev[key] ?? "");
    const nv = String(next[key] ?? "");
    if (pv !== nv) {
      const label = FIELD_LABELS[key];
      const fmtVal = (k, v) => k === "type" ? typeLabel(v) : (v === "" ? "（空白）" : v);
      changes.push(`${label}：「${fmtVal(key, pv)}」→「${fmtVal(key, nv)}」`);
    }
  }
  // 明細
  const pi = prev.items || [];
  const ni = next.items || [];
  for (let i = 0; i < Math.max(pi.length, ni.length); i++) {
    const p = pi[i] || {};
    const n = ni[i] || {};
    if (p.name !== n.name || String(p.qty) !== String(n.qty) || String(p.price) !== String(n.price) || p.taxable !== n.taxable) {
      const row = i + 1;
      if (!p.name && n.name) changes.push(`明細${row}行目：追加「${n.name}」`);
      else if (p.name && !n.name) changes.push(`明細${row}行目：削除「${p.name}」`);
      else {
        const diffs = [];
        if (p.name !== n.name) diffs.push(`品目「${p.name}」→「${n.name}」`);
        if (String(p.qty) !== String(n.qty)) diffs.push(`数量${p.qty}→${n.qty}`);
        if (String(p.price) !== String(n.price)) diffs.push(`単価¥${fmt(p.price)}→¥${fmt(n.price)}`);

        if (diffs.length) changes.push(`明細${row}行目：${diffs.join("、")}`);
      }
    }
  }
  return changes;
}

// ============================================================
// PDF PRINT TEMPLATE
// ============================================================
function buildPrintHTML(doc, company) {
  const { subtotal, discountAmt, total, partialPayment, remaining } = calcTotals(doc);
  const fmtJP = (s) => { if (!s) return "—"; const p = String(s).split("-"); return p.length===3 ? p[0]+"年"+p[1]+"月"+p[2]+"日" : s; };
  const isInv  = doc.type === "invoice";
  const accent = isInv ? "#1a1208" : "#7a5c2e";
  const gold   = "#c8a96e";

  const allItems = [...doc.items];
  while (allItems.length < 10) allItems.push({ name: "", qty: "", price: "", taxable: true });

  const isEst = doc.type === "estimate";
  const itemRows = allItems.slice(0, 10).map((item, i) => {
    const isEmpty = !item.name;
    const { gross, itemDiscount, net } = itemAmounts(item);
    const bg = i % 2 === 0 ? "#fffdf9" : "#f7f3ee";
    if (isEst) {
      // 見積書：値引きを専用列に横1行で表示（行の高さは1段のまま・品目は長ければ2段折り返し）
      const discCell = (!isEmpty && itemDiscount > 0)
        ? `<span style="color:#c0392b;font-size:0.82em;">${item.discountType === "%" ? `${item.discount}%引 ` : "値引 "}－¥ ${fmt(itemDiscount)}</span>`
        : (isEmpty ? "" : `<span style="color:#bbb;">—</span>`);
      const amtCell = isEmpty ? "" : `¥ ${fmt(net)}`;
      return `<tr style="background:${bg};">
        <td style="padding:7px 10px;border-bottom:1px solid #ccc;height:30px;color:#111;word-break:break-all;line-height:1.35;">${item.name || ""}</td>
        <td style="padding:7px 6px;border-bottom:1px solid #ccc;text-align:center;color:#111;">${isEmpty ? "" : item.qty}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #ccc;text-align:right;color:#111;white-space:nowrap;">${isEmpty ? "" : "¥ " + fmt(item.price)}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #ccc;text-align:right;white-space:nowrap;">${discCell}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #ccc;text-align:right;font-weight:${isEmpty ? 400 : 700};color:#111;white-space:nowrap;">${amtCell}</td>
      </tr>`;
    }
    // 請求書：従来どおり4列
    const amt = isEmpty ? "" : `¥ ${fmt(gross)}`;
    return `<tr style="background:${bg};">
      <td style="padding:7px 10px;border-bottom:1px solid #ccc;height:30px;color:#111;">${item.name || ""}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #ccc;text-align:center;color:#111;">${isEmpty ? "" : item.qty}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #ccc;text-align:right;color:#111;">${isEmpty ? "" : "¥ " + fmt(item.price)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #ccc;text-align:right;font-weight:${isEmpty ? 400 : 700};color:#111;">${amt}</td>
    </tr>`;
  }).join("");

  // 明細テーブルのヘッダー（見積書は値引き列を追加）
  const itemHeader = isEst
    ? `<th style="background:${accent};color:${gold};padding:7px 10px;text-align:left;width:40%;font-weight:700;letter-spacing:0.04em;">品目</th>
       <th style="background:${accent};color:${gold};padding:7px 6px;text-align:center;width:9%;font-weight:700;">数量</th>
       <th style="background:${accent};color:${gold};padding:7px 8px;text-align:right;width:17%;font-weight:700;">単価（円）</th>
       <th style="background:${accent};color:${gold};padding:7px 8px;text-align:right;width:17%;font-weight:700;">値引き</th>
       <th style="background:${accent};color:${gold};padding:7px 10px;text-align:right;width:17%;font-weight:700;">金額（円）</th>`
    : `<th style="background:${accent};color:${gold};padding:7px 10px;text-align:left;width:52%;font-weight:700;letter-spacing:0.04em;">品目</th>
       <th style="background:${accent};color:${gold};padding:7px 10px;text-align:center;width:12%;font-weight:700;">数量</th>
       <th style="background:${accent};color:${gold};padding:7px 10px;text-align:right;width:18%;font-weight:700;">単価（円）</th>
       <th style="background:${accent};color:${gold};padding:7px 10px;text-align:right;width:18%;font-weight:700;">金額（円）</th>`;

  const notesLines = (doc.specialNotes || "").split("\n");
  while (notesLines.length < 5) notesLines.push("");
  const noteRows = notesLines.slice(0, 5).map((line) =>
    `<div style="border-bottom:1px solid #e0d8cc;height:26px;line-height:26px;font-size:0.78rem;padding:0 8px;">${line}</div>`
  ).join("");

  // 合計行ブロック
  const discountRow = discountAmt > 0
    ? (isEst
        ? `<tr><td style="padding:5px 20px 5px 10px;color:#c0392b;border-bottom:1px solid #e0d8cc;font-weight:600;">値引き合計</td><td style="padding:5px 10px;text-align:right;border-bottom:1px solid #e0d8cc;color:#c0392b;font-weight:600;">－¥ ${fmt(discountAmt)}</td></tr>`
        : `<tr><td style="padding:4px 20px 4px 10px;color:#c0392b;border-bottom:1px solid #e0d8cc;">${doc.discountType === "%" ? "割引（"+doc.discount+"%）" : "値引"}</td><td style="padding:4px 10px;text-align:right;border-bottom:1px solid #e0d8cc;color:#c0392b;">－¥ ${fmt(discountAmt)}</td></tr>`)
    : "";
  const summaryRows = `
    <tr><td style="padding:5px 20px 5px 10px;color:#333;border-bottom:1px solid #ccc;font-weight:600;">小計</td><td style="padding:5px 10px;text-align:right;border-bottom:1px solid #ccc;min-width:115px;font-weight:600;">¥ ${fmt(subtotal)}</td></tr>
    ${discountRow}
    <tr style="border-top:2px solid ${gold};"><td style="padding:7px 20px 7px 10px;font-weight:700;font-size:0.9rem;color:${accent};">合計（税込）</td><td style="padding:7px 10px;text-align:right;font-weight:700;font-size:1rem;">¥ ${fmt(total)}</td></tr>
    ${isInv && partialPayment > 0 ? `
    <tr><td style="padding:4px 20px 4px 10px;color:#2d6a9e;border-bottom:1px solid #e0d8cc;">内入金済み</td><td style="padding:4px 10px;text-align:right;border-bottom:1px solid #e0d8cc;color:#2d6a9e;">－¥ ${fmt(partialPayment)}</td></tr>
    <tr style="background:#1a120808;"><td style="padding:8px 20px 8px 10px;font-weight:700;font-size:0.95rem;color:${accent};">ご請求金額残</td><td style="padding:8px 10px;text-align:right;font-weight:700;font-size:1.05rem;color:${accent};">¥ ${fmt(remaining)}</td></tr>
    ` : ""}
  `;

  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8">
<title>${isInv ? "請求書" : "見積書"} ${doc.docNumber}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  html,body{width:210mm;min-height:297mm;}
  body{font-family:'Noto Serif JP',Georgia,serif;color:#1a1208;background:#fff;padding:12mm 14mm 10mm 14mm;font-size:11pt;}
  @page{size:A4 portrait;margin:0;}
  @media print{html,body{width:210mm;min-height:297mm;}}
</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:9px;">
  <div>
    <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:5px;">
      <h1 style="font-size:1.8rem;font-weight:700;letter-spacing:0.12em;color:${accent};margin:0;">${isInv ? "請求書" : "見積書"}</h1>
      <span style="background:${accent};color:${gold};font-size:0.6rem;font-weight:700;letter-spacing:0.12em;padding:2px 10px;border-radius:2px;">${isInv ? "INVOICE" : "ESTIMATE"}</span>
    </div>
    <table style="font-size:0.8rem;border-collapse:collapse;margin-top:4px;">
      <tr>
        <td style="color:#555;padding-right:8px;padding-bottom:5px;">${isInv ? "請求書番号" : "見積書番号"}</td>
        <td style="font-weight:700;color:#111;padding-right:24px;padding-bottom:5px;">${doc.docNumber}</td>
        <td style="color:#555;padding-right:8px;padding-bottom:5px;">作成日</td>
        <td style="font-weight:700;color:#111;padding-bottom:5px;">${fmtJP(doc.createdAt)}</td>
      </tr>
      <tr>
        <td style="color:#555;padding-right:8px;">${isInv ? "支払期限" : "有効期限"}</td>
        <td style="font-weight:700;color:${isInv ? "#c0392b" : accent};padding-right:24px;">${fmtJP(doc.dueDate)}</td>
        <td style="color:#555;padding-right:8px;">施行日</td>
        <td style="font-weight:700;color:${accent};">${fmtJP(doc.workDate)}</td>
      </tr>
    </table>
  </div>
  <div style="text-align:right;font-size:0.75rem;line-height:1.9;color:#222;">
    <div style="font-weight:700;font-size:0.95rem;color:#1a1208;margin-bottom:2px;">${company.name}</div>
    <div>${company.postal}　${company.address}</div>
    <div>TEL: ${company.tel}　FAX: ${company.fax}</div>
    <div>${company.email}</div>
    <div style="color:${accent};font-weight:700;margin-top:2px;">担当: ${doc.staff}</div>
    ${company.invoiceNo ? `<div style="font-size:0.72rem;color:#555;margin-top:1px;">登録番号: ${company.invoiceNo}</div>` : ""}
  </div>
</div>
<div style="height:2px;background:linear-gradient(to right,${accent},${gold},#f5f0eb);margin-bottom:9px;"></div>
<div style="margin-bottom:9px;">
  <div style="font-size:0.98rem;font-weight:700;border-bottom:2px solid ${gold};padding-bottom:3px;margin-bottom:5px;display:inline-block;">${doc.clientName || "　"}　${doc.honorific || "御中"}</div>
  <div style="font-size:0.85rem;display:flex;gap:8px;"><span style="color:${accent};font-weight:700;white-space:nowrap;">件名</span><span>${doc.subject}</span></div>
  <div style="font-size:0.8rem;color:#333;display:flex;gap:8px;margin-top:3px;"><span style="white-space:nowrap;">備考</span><span>${doc.note || ""}</span></div>
</div>
<table style="width:100%;border-collapse:collapse;font-size:0.85rem;margin-bottom:8px;">
  <thead><tr>
    ${itemHeader}
  </tr></thead>
  <tbody>${itemRows}</tbody>
</table>
<div style="display:flex;justify-content:flex-end;margin-bottom:11px;">
  <table style="font-size:0.88rem;border-collapse:collapse;min-width:280px;"><tbody>${summaryRows}</tbody></table>
</div>
<div style="margin-bottom:11px;">
  <div style="font-size:0.8rem;font-weight:700;letter-spacing:0.08em;color:${accent};border-left:3px solid ${gold};padding-left:8px;margin-bottom:5px;">特記事項</div>
  <div style="border:1px solid #c8b88a;border-radius:2px;padding:4px 10px;">${noteRows}</div>
</div>
${isInv ? `<div style="border:1px solid ${gold};border-radius:2px;padding:8px 14px;font-size:0.82rem;"><span style="font-weight:700;color:${accent};margin-right:12px;">■ お振込先</span><span style="color:#222;">${company.bank}</span></div>` : ""}
</body></html>`;
}

// ============================================================
// PDF PRINT TEMPLATE（報告書）
// ============================================================
function buildReportPrintHTML(doc, company) {
  const { rows, totalRebate, rebateTax, rebateWithTax } = calcReport(doc.reportItems || [], doc.type);
  const fmtJPR = (s) => { if (!s) return "—"; const p = String(s).split("-"); return p.length===3 ? p[0]+"年"+p[1]+"月"+p[2]+"日" : s; };
  const isWithTax = doc.type === "report_tax";
  const accent = isWithTax ? "#2d5a3d" : "#4a3d7a";
  const gold   = "#c8a96e";
  const fmtD   = (s) => s ? s.replace(/-/g, "/") : "—";
  const LIGHT  = isWithTax ? "#f0f5f1" : "#f0eef8";
  const borderC = isWithTax ? "#dde8e0" : "#ddd8ee";

  const allRows = [...(rows || [])];
  while (allRows.length < 10) allRows.push({ workDate:"", user:"", referral:"", rebateRate:0, chargeAmount:0, rebateAmount:0 });

  const itemRows = allRows.slice(0,10).map((row,i) => {
    const isEmpty = !row.workDate && !row.user && !row.referral;
    const bg = i % 2 === 0 ? "#fff" : LIGHT;
    return `<tr style="background:${bg};">
      <td style="padding:6px 8px;border-bottom:1px solid ${borderC};height:28px;">${fmtD(row.workDate)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid ${borderC};">${row.user||""}</td>
      <td style="padding:6px 8px;border-bottom:1px solid ${borderC};">${row.referral||""}</td>
      <td style="padding:6px 8px;border-bottom:1px solid ${borderC};text-align:center;">${isEmpty?"":row.rebateRate+"%"}</td>
      ${isWithTax ? `<td style="padding:6px 8px;border-bottom:1px solid ${borderC};text-align:right;">${isEmpty?"":"¥ "+Number(row.chargeAmount||0).toLocaleString("ja-JP")}</td>` : ""}
      <td style="padding:6px 8px;border-bottom:1px solid ${borderC};text-align:right;font-weight:${isEmpty?400:600};">${isEmpty?"":"¥ "+Number(row.rebateAmount||0).toLocaleString("ja-JP")}</td>
    </tr>`;
  }).join("");

  const notesLines = (doc.specialNotes || "").split("\n");
  while (notesLines.length < 5) notesLines.push("");
  const noteRows = notesLines.slice(0,5).map(line =>
    `<div style="border-bottom:1px solid #e0d8cc;height:26px;line-height:26px;font-size:0.78rem;padding:0 8px;">${line}</div>`
  ).join("");

  const colsWith    = isWithTax ? `<th style="background:${accent};color:${gold};padding:6px 8px;text-align:left;width:14%;font-weight:600;">施行日</th><th style="background:${accent};color:${gold};padding:6px 8px;text-align:left;width:13%;font-weight:600;">ご使用者</th><th style="background:${accent};color:${gold};padding:6px 8px;text-align:left;width:25%;font-weight:600;">ご紹介内容</th><th style="background:${accent};color:${gold};padding:6px 8px;text-align:center;width:10%;font-weight:600;">リベート率</th><th style="background:${accent};color:${gold};padding:6px 8px;text-align:right;width:19%;font-weight:600;">ご請求金額（円）</th><th style="background:${accent};color:${gold};padding:6px 8px;text-align:right;width:19%;font-weight:600;">リベート額（円）</th>` : `<th style="background:${accent};color:${gold};padding:6px 8px;text-align:left;width:16%;font-weight:600;">施行日</th><th style="background:${accent};color:${gold};padding:6px 8px;text-align:left;width:16%;font-weight:600;">ご使用者</th><th style="background:${accent};color:${gold};padding:6px 8px;text-align:left;width:36%;font-weight:600;">ご紹介内容</th><th style="background:${accent};color:${gold};padding:6px 8px;text-align:center;width:12%;font-weight:600;">リベート率</th><th style="background:${accent};color:${gold};padding:6px 8px;text-align:right;width:20%;font-weight:600;">リベート額（円）</th>`;

  const summaryRows = isWithTax
    ? `<tr><td style="padding:4px 16px 4px 10px;color:#666;border-bottom:1px solid ${borderC};">リベート合計（税抜き）</td><td style="padding:4px 10px;text-align:right;min-width:130px;">¥ ${totalRebate.toLocaleString("ja-JP")}</td></tr>
       <tr><td style="padding:4px 16px 4px 10px;color:#666;border-bottom:1px solid ${borderC};">消費税（10%）</td><td style="padding:4px 10px;text-align:right;">¥ ${rebateTax.toLocaleString("ja-JP")}</td></tr>
       <tr style="background:${accent};"><td style="padding:8px 16px 8px 10px;font-weight:700;font-size:0.9rem;color:${gold};">リベート合計（税込み）</td><td style="padding:8px 10px;text-align:right;font-weight:700;font-size:1rem;color:${gold};">¥ ${rebateWithTax.toLocaleString("ja-JP")}</td></tr>`
    : `<tr style="background:${accent};"><td style="padding:8px 16px 8px 10px;font-weight:700;font-size:0.9rem;color:${gold};">リベート合計（税抜き）</td><td style="padding:8px 10px;text-align:right;font-weight:700;font-size:1rem;color:${gold};">¥ ${totalRebate.toLocaleString("ja-JP")}</td></tr>`;

  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8">
<title>報告書 ${doc.reportNumber||""}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  html,body{width:210mm;min-height:297mm;}
  body{font-family:'Noto Serif JP',Georgia,serif;color:#1a1208;background:#fff;padding:13mm 14mm 11mm 14mm;font-size:10pt;}
  @page{size:A4 portrait;margin:0;}
</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:9px;">
  <div>
    <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:5px;">
      <h1 style="font-size:1.8rem;font-weight:700;letter-spacing:0.12em;color:${accent};margin:0;">報告書</h1>
      <span style="background:${accent};color:${gold};font-size:0.6rem;font-weight:700;letter-spacing:0.12em;padding:2px 10px;border-radius:2px;">${isWithTax?"REPORT（税有）":"REPORT（税無）"}</span>
    </div>
    <table style="font-size:0.7rem;border-collapse:collapse;margin-top:4px;">
      <tr>
        <td style="color:#888;padding-right:8px;padding-bottom:4px;">報告書番号</td>
        <td style="font-weight:700;padding-bottom:4px;">${doc.reportNumber||""}</td>
      </tr>
      <tr>
        <td style="color:#888;padding-right:8px;">作成日</td>
        <td style="font-weight:700;color:${accent};">${fmtJPR(doc.createdAt)}</td>
      </tr>
    </table>
  </div>
  <div style="text-align:right;font-size:0.68rem;line-height:1.8;color:#444;">
    <div style="font-weight:700;font-size:0.85rem;color:#1a1208;margin-bottom:2px;">${company.name}</div>
    <div>${company.postal}　${company.address}</div>
    <div>TEL: ${company.tel}　FAX: ${company.fax}</div>
    <div>${company.email}</div>
    <div style="color:${accent};font-weight:600;margin-top:2px;">担当: ${doc.staff||""}</div>
  </div>
</div>
<div style="height:2px;background:linear-gradient(to right,${accent},${gold},#f5f0eb);margin-bottom:9px;"></div>
<div style="margin-bottom:9px;">
  <div style="font-size:0.98rem;font-weight:700;border-bottom:2px solid ${gold};padding-bottom:3px;margin-bottom:5px;display:inline-block;">${doc.clientName||"　"}　${doc.honorific||"御中"}</div>
  <div style="font-size:0.75rem;display:flex;gap:8px;"><span style="color:${accent};font-weight:700;white-space:nowrap;">件名</span><span>${doc.subject||""}</span></div>
  ${doc.note ? `<div style="font-size:0.72rem;color:#666;display:flex;gap:8px;margin-top:2px;"><span>備考</span><span>${doc.note}</span></div>` : ""}
</div>
<table style="width:100%;border-collapse:collapse;font-size:0.77rem;margin-bottom:8px;">
  <thead><tr>${colsWith}</tr></thead>
  <tbody>${itemRows}</tbody>
</table>
<div style="display:flex;justify-content:flex-end;margin-bottom:11px;">
  <table style="font-size:0.78rem;border-collapse:collapse;min-width:280px;"><tbody>${summaryRows}</tbody></table>
</div>
<div style="margin-bottom:11px;">
  <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;color:${accent};border-left:3px solid ${gold};padding-left:8px;margin-bottom:5px;">特記事項</div>
  <div style="border:1px solid #c8b88a;border-radius:2px;padding:4px 10px;">${noteRows}</div>
</div>
</body></html>`;
}

// ============================================================
// STYLES
// ============================================================
const S = {
  app:          { fontFamily: "'Noto Serif JP', Georgia, serif", background: "#f5f0eb", minHeight: "100vh", color: "#1a1208" },
  header:       { background: "#1a1208", color: "#e8d9c0", padding: "0 2rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64, boxShadow: "0 2px 12px #0006" },
  headerTitle:  { fontSize: "1.15rem", fontWeight: 700, letterSpacing: "0.08em", margin: 0 },
  navBtn: (a)  => ({ background: a ? "#c8a96e" : "transparent", color: a ? "#1a1208" : "#e8d9c0", border: "1px solid #c8a96e44", borderRadius: 4, padding: "6px 16px", cursor: "pointer", fontFamily: "inherit", fontSize: "0.85rem", transition: "all .2s" }),
  main:         { maxWidth: 1040, margin: "0 auto", padding: "2rem 1rem" },
  card:         { background: "#fff", borderRadius: 8, boxShadow: "0 2px 16px #1a120812", padding: "1.5rem 2rem", marginBottom: "1.25rem" },
  sectionTitle: { fontSize: "0.92rem", fontWeight: 700, letterSpacing: "0.1em", borderBottom: "2px solid #c8a96e", paddingBottom: 5, marginBottom: 14, color: "#7a5c2e" },
  label:        { display: "block", fontSize: "0.76rem", color: "#7a5c2e", marginBottom: 3, fontWeight: 600, letterSpacing: "0.05em" },
  input:        { width: "100%", border: "1px solid #d4c4a0", borderRadius: 4, padding: "7px 10px", fontFamily: "inherit", fontSize: "0.88rem", background: "#fffdf9", color: "#1a1208", boxSizing: "border-box" },
  select:       { width: "100%", border: "1px solid #d4c4a0", borderRadius: 4, padding: "7px 10px", fontFamily: "inherit", fontSize: "0.88rem", background: "#fffdf9", color: "#1a1208", boxSizing: "border-box" },
  btn:   (c = "#c8a96e") => ({ background: c, color: c === "#c8a96e" ? "#1a1208" : "#fff", border: "none", borderRadius: 4, padding: "8px 20px", cursor: "pointer", fontFamily: "inherit", fontSize: "0.88rem", fontWeight: 700, letterSpacing: "0.05em", transition: "opacity .2s" }),
  btnSm: (c = "#c8a96e") => ({ background: c, color: c === "#c8a96e" ? "#1a1208" : "#fff", border: "none", borderRadius: 4, padding: "4px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: "0.78rem", fontWeight: 700 }),
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" },
  grid3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" },
  grid4: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "1rem" },
  row:   { display: "flex", gap: "0.75rem", alignItems: "center" },
  tag:   (t) => ({ display: "inline-block", padding: "2px 10px", borderRadius: 12, fontSize: "0.73rem", fontWeight: 700, background: t === "invoice" ? "#1a1208" : "#c8a96e", color: t === "invoice" ? "#c8a96e" : "#1a1208" }),
  th:    { background: "#1a1208", color: "#c8a96e", padding: "7px 10px", textAlign: "left", fontWeight: 600, fontSize: "0.82rem" },
  td:    { padding: "7px 10px", borderBottom: "1px solid #e8d9c0", fontSize: "0.84rem" },
};

// ============================================================
// REPORT ROW（報告書明細行）★ App の外で定義
// ============================================================
function ReportRow({ row, idx, referralItems, onChange, onClear, accent }) {
  const rebate = Math.round(Number(row.chargeAmount || 0) * Number(row.rebateRate || 0) / 100);
  return (
    <tr style={{ background: idx % 2 === 0 ? "#fffdf9" : "#f7f3ee" }}>
      <td style={{ padding: "6px 6px", borderBottom: "1px solid #e8d9c0", width: "12%" }}>
        <input type="date" style={{ width: "100%", border: "1px solid #d4c4a0", borderRadius: 4, padding: "5px 6px", fontFamily: "inherit", fontSize: "0.76rem", background: "#fffdf9", boxSizing: "border-box" }}
          value={row.workDate} onChange={(e) => onChange(idx, { workDate: e.target.value })} />
      </td>
      <td style={{ padding: "6px 6px", borderBottom: "1px solid #e8d9c0", width: "11%" }}>
        <input style={{ width: "100%", border: "1px solid #d4c4a0", borderRadius: 4, padding: "5px 6px", fontFamily: "inherit", fontSize: "0.76rem", background: "#fffdf9", boxSizing: "border-box" }}
          placeholder="〇〇 様" value={row.user} onChange={(e) => onChange(idx, { user: e.target.value })} />
      </td>
      <td style={{ padding: "6px 6px", borderBottom: "1px solid #e8d9c0", width: "26%" }}>
        <div style={{ display: "flex", gap: 3 }}>
          <select style={{ border: "1px solid #d4c4a0", borderRadius: 4, padding: "5px 4px", fontFamily: "inherit", fontSize: "0.73rem", background: "#fffdf9", flex: "0 0 auto", width: 110 }}
            value="" onChange={(e) => { if (e.target.value) onChange(idx, { referral: e.target.value }); }}>
            <option value="">マスターから</option>
            {referralItems.map((r) => <option key={r.id} value={r.text}>{r.text}</option>)}
          </select>
          <input style={{ flex: 1, border: "1px solid #d4c4a0", borderRadius: 4, padding: "5px 6px", fontFamily: "inherit", fontSize: "0.74rem", background: "#fffdf9", boxSizing: "border-box" }}
            placeholder="ご紹介内容" value={row.referral} onChange={(e) => onChange(idx, { referral: e.target.value })} />
        </div>
      </td>
      <td style={{ padding: "6px 6px", borderBottom: "1px solid #e8d9c0", width: "10%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <input type="number" min="0" max="100" style={{ width: "100%", border: "1px solid #d4c4a0", borderRadius: 4, padding: "5px 6px", fontFamily: "inherit", fontSize: "0.8rem", background: "#fffdf9", textAlign: "right", boxSizing: "border-box" }}
            value={row.rebateRate} onChange={(e) => onChange(idx, { rebateRate: e.target.value })} />
          <span style={{ fontSize: "0.78rem", color: "#7a5c2e" }}>%</span>
        </div>
      </td>
      <td style={{ padding: "6px 6px", borderBottom: "1px solid #e8d9c0", width: "15%" }}>
        <input type="number" min="0" style={{ width: "100%", border: "1px solid #d4c4a0", borderRadius: 4, padding: "5px 6px", fontFamily: "inherit", fontSize: "0.8rem", background: "#fffdf9", textAlign: "right", boxSizing: "border-box" }}
          value={row.chargeAmount} onChange={(e) => onChange(idx, { chargeAmount: e.target.value })} />
      </td>
      <td style={{ padding: "6px 6px", borderBottom: "1px solid #e8d9c0", width: "14%", textAlign: "right", fontWeight: 600, color: row.referral || row.chargeAmount > 0 ? accent : "#ccc" }}>
        {row.referral || row.chargeAmount > 0 ? `¥ ${fmt(rebate)}` : "—"}
      </td>
      <td style={{ padding: "6px 6px", borderBottom: "1px solid #e8d9c0", width: "4%", textAlign: "center" }}>
        <button style={{ background: "#bbb", color: "#fff", border: "none", borderRadius: 4, padding: "4px 8px", cursor: "pointer", fontFamily: "inherit", fontSize: "0.75rem", fontWeight: 700 }} onClick={() => onClear(idx)}>✕</button>
      </td>
    </tr>
  );
}

// ============================================================
// ITEM ROW
// ============================================================
function ItemRow({ item, idx, products, onChange, onClear, isEstimate }) {
  const { gross, itemDiscount, net } = itemAmounts(item);
  return (
    <tr style={{ background: idx % 2 === 0 ? "#fffdf9" : "#f7f3ee" }}>
      {/* 品目 */}
      <td style={{ ...S.td, width: isEstimate ? "34%" : "55%" }}>
        <div style={{ display: "flex", gap: 4 }}>
          <select style={{ ...S.select, flex: "0 0 auto", width: isEstimate ? 120 : 148, fontSize: "0.78rem" }} value=""
            onChange={(e) => {
              const p = products.find((p) => p.name === e.target.value);
              if (p) onChange(idx, { name: p.name, price: p.price, amount: undefined });
            }}>
            <option value="">マスターから選択</option>
            {products.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
          <input style={{ ...S.input, flex: 1, fontSize: "0.82rem" }} placeholder="品目名を入力"
            value={item.name} onChange={(e) => onChange(idx, { name: e.target.value })} />
        </div>
      </td>
      {/* 数量 */}
      <td style={{ ...S.td, width: isEstimate ? "8%" : "10%" }}>
        <input type="number" min="0" style={{ ...S.input, textAlign: "right" }}
          value={item.qty} onChange={(e) => onChange(idx, { qty: e.target.value, amount: undefined })} />
      </td>
      {/* 単価 */}
      <td style={{ ...S.td, width: isEstimate ? "13%" : "16%" }}>
        <input type="number" min="0" style={{ ...S.input, textAlign: "right" }}
          value={item.price} onChange={(e) => onChange(idx, { price: e.target.value, amount: undefined })} />
      </td>
      {/* 値引き（見積書のみ） */}
      {isEstimate && (
        <td style={{ ...S.td, width: "20%" }}>
          <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
            <select style={{ ...S.select, width: 58, fontSize: "0.74rem", padding: "5px 4px" }}
              value={item.discountType || ""}
              onChange={(e) => onChange(idx, { discountType: e.target.value })}>
              <option value="">なし</option>
              <option value="%">％</option>
              <option value="¥">¥</option>
            </select>
            <input type="number" min="0" disabled={!item.discountType}
              style={{ ...S.input, textAlign: "right", opacity: item.discountType ? 1 : 0.4 }}
              value={item.discount || ""} onChange={(e) => onChange(idx, { discount: e.target.value })} />
          </div>
        </td>
      )}
      {/* 金額 */}
      <td style={{ ...S.td, width: isEstimate ? "20%" : "14%", textAlign: "right", fontWeight: 600 }}>
        {!item.name ? "—" : (isEstimate && itemDiscount > 0
          ? <span>
              <span style={{ textDecoration: "line-through", color: "#999", fontSize: "0.78em" }}>¥ {fmt(gross)}</span>
              <br /><span style={{ color: "#c0392b" }}>¥ {fmt(net)}</span>
            </span>
          : `¥ ${fmt(gross)}`)}
      </td>
      {/* クリア */}
      <td style={{ ...S.td, width: "5%", textAlign: "center" }}>
        <button style={S.btnSm("#bbb")} onClick={() => onClear(idx)}>✕</button>
      </td>
    </tr>
  );
}

// ============================================================
// REPORT EDIT PANEL  ★ App の外で定義
// ============================================================
function ReportEditPanel({ form, setField, setReportRow, clearReportRow, companies, staff, referralItems, reportClients, reportSubjects, saveDoc, printPDF, _skipOpBar }) {
  const accent  = form.type === "report_tax" ? ACCENT_RPT_TAX : ACCENT_RPT_NOTAX;
  const isWithTax = form.type === "report_tax";
  const company = companies.find((c) => c.id === form.companyId) || companies[0] || {};
  const { totalRebate, rebateTax, rebateWithTax } = calcReport(form.reportItems || [], form.type);

  const sTitle = { fontSize: "0.92rem", fontWeight: 700, letterSpacing: "0.1em", borderBottom: "2px solid #c8a96e", paddingBottom: 5, marginBottom: 14, color: accent };
  const S2 = {
    card:   { background: "#fff", borderRadius: 8, boxShadow: "0 2px 16px #1a120812", padding: "1.5rem 2rem", marginBottom: "1.25rem" },
    label:  { display: "block", fontSize: "0.76rem", color: "#7a5c2e", marginBottom: 3, fontWeight: 600, letterSpacing: "0.05em" },
    input:  { width: "100%", border: "1px solid #d4c4a0", borderRadius: 4, padding: "7px 10px", fontFamily: "inherit", fontSize: "0.88rem", background: "#fffdf9", color: "#1a1208", boxSizing: "border-box" },
    select: { width: "100%", border: "1px solid #d4c4a0", borderRadius: 4, padding: "7px 10px", fontFamily: "inherit", fontSize: "0.88rem", background: "#fffdf9", color: "#1a1208", boxSizing: "border-box" },
    btn:    (c="#c8a96e") => ({ background: c, color: c==="#c8a96e"?"#1a1208":"#fff", border: "none", borderRadius: 4, padding: "8px 20px", cursor: "pointer", fontFamily: "inherit", fontSize: "0.88rem", fontWeight: 700 }),
    grid2:  { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" },
    grid3:  { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" },
    th:     { background: accent, color: "#c8a96e", padding: "7px 8px", textAlign: "left", fontWeight: 600, fontSize: "0.8rem" },
  };

  return (
    <div>
      {/* 操作バー（EditPanel から呼ばれた場合はスキップ） */}
      {!_skipOpBar && (
      <div style={{ ...S2.card, padding: "1rem 1.5rem", display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontWeight: 700, color: accent, fontSize: "0.95rem" }}>
          📋 {isWithTax ? "報告書（税有）" : "報告書（税無）"}
        </span>
        <div style={{ flex: 1 }} />
        <button style={S2.btn("#2ecc71")} onClick={saveDoc}>💾 保存</button>
        <button style={S2.btn("#1a1208")} onClick={() => printPDF(form)}>🖨 PDF出力</button>
      </div>
      )}

      {/* 基本情報 */}
      <div style={S2.card}>
        <div style={sTitle}>基本情報</div>
        <div style={S2.grid3}>
          <div>
            <label style={S2.label}>報告書番号</label>
            <input style={S2.input} value={form.reportNumber || ""} onChange={(e) => setField("reportNumber", e.target.value)} />
          </div>
          <div>
            <label style={S2.label}>作成日</label>
            <input type="date" style={S2.input} value={form.createdAt} onChange={(e) => setField("createdAt", e.target.value)} />
          </div>
          <div>
            <label style={S2.label}>発行会社</label>
            <select style={S2.select} value={form.companyId} onChange={(e) => setField("companyId", Number(e.target.value))}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginTop: "1rem" }}>
          <label style={S2.label}>作成者</label>
          <select style={{ ...S2.select, maxWidth: 240 }} value={form.staff} onChange={(e) => setField("staff", e.target.value)}>
            {staff.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {/* 案件情報 */}
      <div style={S2.card}>
        <div style={sTitle}>案件情報</div>
        <div style={{ marginBottom: 10 }}>
          <label style={S2.label}>宛先（会社名）</label>
          <div style={{ display: "flex", gap: 4 }}>
            <select style={{ ...S2.select, flex: "0 0 auto", width: 200, fontSize: "0.82rem" }} value=""
              onChange={(e) => { if (e.target.value) setField("clientName", e.target.value); }}>
              <option value="">マスターから選択</option>
              {reportClients.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            <input style={{ ...S2.input, flex: 1 }} placeholder="株式会社〇〇" value={form.clientName} onChange={(e) => setField("clientName", e.target.value)} />
          </div>
        </div>
        <div style={S2.grid2}>
          <div>
            <label style={S2.label}>件名</label>
            <div style={{ display: "flex", gap: 4 }}>
              <select style={{ ...S2.select, flex: "0 0 auto", width: 200, fontSize: "0.82rem" }} value=""
                onChange={(e) => { if (e.target.value) setField("subject", e.target.value); }}>
                <option value="">マスターから選択</option>
                {reportSubjects.map((s) => <option key={s.id} value={s.text}>{s.text}</option>)}
              </select>
              <input style={{ ...S2.input, flex: 1 }} placeholder="2026年〇月度 リベート報告書" value={form.subject} onChange={(e) => setField("subject", e.target.value)} />
            </div>
          </div>
          <div>
            <label style={S2.label}>備考</label>
            <input style={S2.input} placeholder="上記の通りご報告申し上げます。" value={form.note} onChange={(e) => setField("note", e.target.value)} />
          </div>
        </div>
      </div>

      {/* 明細 */}
      <div style={S2.card}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <div style={{ ...sTitle, margin: 0, flex: 1 }}>明細（最大10行）</div>
          <span style={{ fontSize: "0.75rem", color: accent, background: "#f5f0eb", padding: "3px 10px", borderRadius: 4, border: "1px solid #c8a96e55" }}>リベート額は自動計算</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
            <thead><tr>
              <th style={{ ...S2.th, width: "12%" }}>施行日</th>
              <th style={{ ...S2.th, width: "11%" }}>ご使用者</th>
              <th style={{ ...S2.th, width: "26%" }}>ご紹介内容</th>
              <th style={{ ...S2.th, width: "10%", textAlign: "center" }}>リベート率</th>
              <th style={{ ...S2.th, width: "15%", textAlign: "right" }}>ご請求金額（円）</th>
              <th style={{ ...S2.th, width: "14%", textAlign: "right" }}>リベート額（円）</th>
              <th style={{ ...S2.th, width: "4%" }}></th>
            </tr></thead>
            <tbody>
              {(form.reportItems || []).map((row, idx) => (
                <ReportRow key={idx} row={row} idx={idx} referralItems={referralItems}
                  onChange={setReportRow} onClear={clearReportRow} accent={accent} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* リベート合計 */}
      <div style={S2.card}>
        <div style={sTitle}>リベート合計</div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <table style={{ fontSize: "0.88rem", borderCollapse: "collapse", minWidth: 320 }}>
            <tbody>
              {isWithTax ? (
                <>
                  <tr>
                    <td style={{ padding: "5px 20px 5px 8px", color: "#666" }}>リベート合計（税抜き）</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", minWidth: 130 }}>¥ {fmt(totalRebate)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "5px 20px 5px 8px", color: "#666" }}>消費税（10%）</td>
                    <td style={{ padding: "5px 8px", textAlign: "right" }}>¥ {fmt(rebateTax)}</td>
                  </tr>
                  <tr style={{ background: accent }}>
                    <td style={{ padding: "9px 20px 9px 12px", fontWeight: 700, color: "#c8a96e", fontSize: "0.95rem" }}>リベート合計（税込み）</td>
                    <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700, fontSize: "1.1rem", color: "#c8a96e" }}>¥ {fmt(rebateWithTax)}</td>
                  </tr>
                </>
              ) : (
                <tr style={{ background: accent }}>
                  <td style={{ padding: "9px 20px 9px 12px", fontWeight: 700, color: "#c8a96e", fontSize: "0.95rem" }}>リベート合計（税抜き）</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700, fontSize: "1.1rem", color: "#c8a96e", minWidth: 130 }}>¥ {fmt(totalRebate)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 特記事項 */}
      <div style={S2.card}>
        <div style={sTitle}>特記事項</div>
        <textarea style={{ width: "100%", border: "1px solid #d4c4a0", borderRadius: 4, padding: "7px 10px", fontFamily: "inherit", fontSize: "0.88rem", background: "#fffdf9", color: "#1a1208", boxSizing: "border-box", height: 120, resize: "vertical", lineHeight: 1.8 }}
          placeholder="特記事項を入力（5行程度）"
          value={form.specialNotes || ""} onChange={(e) => setField("specialNotes", e.target.value)} />
        <div style={{ fontSize: "0.72rem", color: "#aaa", marginTop: 4 }}>※ PDF出力時に5行の罫線枠に表示されます</div>
      </div>

      {/* 発行元確認 */}
      <div style={{ ...S2.card, background: "#fffdf4" }}>
        <div style={sTitle}>発行元情報（確認）</div>
        {company.name
          ? <div style={{ fontSize: "0.85rem", lineHeight: 1.9 }}>
              <strong>{company.name}</strong><br />
              {company.postal} {company.address}<br />
              TEL: {company.tel} / FAX: {company.fax} / {company.email}
            </div>
          : <p style={{ color: "#aaa" }}>マスター管理から会社情報を設定してください。</p>}
      </div>

      {/* 下部 保存ボタン */}
      <div style={{ ...S2.card, padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12 }}>
        <span style={{ fontSize: "0.82rem", color: "#aaa" }}>入力が完了したら保存してください</span>
        <button style={{ ...S2.btn("#2ecc71"), padding: "10px 32px", fontSize: "1rem" }} onClick={saveDoc}>💾 保存</button>
        <button style={{ ...S2.btn("#1a1208"), padding: "10px 24px", fontSize: "1rem" }} onClick={() => printPDF(form)}>🖨 PDF出力</button>
      </div>
    </div>
  );
}

// ============================================================
// DETAIL MODAL
// ============================================================
// ============================================================
// IMPORT WIZARD  ★ App 外で定義（Hooksルール準拠）
// ============================================================
function ImportWizard({ step, form, setField, onNext, subjects }) {
  const STEPS = [
    { key: "dueDate",    label: "支払期限", type: "date",    icon: "📅" },
    { key: "workDate",   label: "施行日",   type: "date",    icon: "🏛" },
    { key: "clientName", label: "宛先",     type: "client",  icon: "🏢" },
    { key: "subject",    label: "件名",     type: "subject", icon: "📋" },
  ];
  const total  = STEPS.length;
  const info   = STEPS[step];
  const isLast = step === total - 1;
  const isFirst = step === 0;

  const toJP = (s) => {
    if (!s) return "（未設定）";
    const p = String(s).split("-");
    return p.length === 3 ? p[0] + "年" + p[1] + "月" + p[2] + "日" : s;
  };

  const curVal = info.key === "clientName"
    ? (form.clientName || "（未設定）") + "　" + (form.honorific || "御中")
    : info.type === "date" ? toJP(form[info.key]) : (form[info.key] || "（未設定）");

  const [editing,      setEditing]      = useState(false);
  const [tmpDate,      setTmpDate]      = useState(form[info.key] || "");
  const [tmpText,      setTmpText]      = useState(form[info.key] || "");
  const [tmpClient,    setTmpClient]    = useState(form.clientName || "");
  const [tmpHonorific, setTmpHonorific] = useState(form.honorific || "御中");

  const goNext = () => onNext(isLast ? null : step + 1);
  const goPrev = () => onNext(step - 1);  // ① 前のステップへ戻る

  const saveAndNext = () => {
    if (info.type === "date")    setField(info.key, tmpDate);
    if (info.type === "subject") setField(info.key, tmpText);
    if (info.type === "client")  { setField("clientName", tmpClient); setField("honorific", tmpHonorific); }
    goNext();
  };

  const startEdit = () => {
    setTmpDate(form[info.key] || "");
    setTmpText(form[info.key] || "");
    setTmpClient(form.clientName || "");
    setTmpHonorific(form.honorific || "御中");
    setEditing(true);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0009", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "#fff", borderRadius: 12, width: "100%", maxWidth: 520, boxShadow: "0 12px 48px #0006", fontFamily: "inherit", overflow: "hidden" }}>

        {/* ヘッダー */}
        <div style={{ background: "#1a1208", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ color: "#c8a96e", fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 2 }}>
              確認ウィザード　{step + 1} / {total}
            </div>
            <div style={{ color: "#fff", fontSize: "1rem", fontWeight: 700 }}>
              {info.icon} {info.label}の確認
            </div>
          </div>
          {/* プログレスバー（クリックで移動可） */}
          <div style={{ display: "flex", gap: 6 }}>
            {STEPS.map((s, idx) => (
              <div key={idx}
                onClick={() => onNext(idx)}
                title={s.label}
                style={{ width: 28, height: 6, borderRadius: 3, cursor: "pointer",
                  background: idx <= step ? "#c8a96e" : "#ffffff33",
                  outline: idx === step ? "2px solid #fff" : "none" }} />
            ))}
          </div>
        </div>

        {/* 本文 */}
        <div style={{ padding: "24px 28px 20px" }}>
          {!editing ? (
            <>
              <p style={{ fontSize: "0.85rem", color: "#555", marginBottom: 12 }}>
                読み込んだデータの内容を確認してください。
              </p>

              {/* ② 支払期限ステップ：施行日をヒント表示 */}
              {info.key === "dueDate" && (
                <div style={{ background: "#f0f5f1", border: "1px solid #2d5a3d33", borderRadius: 6, padding: "8px 14px", marginBottom: 12, fontSize: "0.8rem", color: "#2d5a3d" }}>
                  🏛 施行日（参考）：<strong>{toJP(form.workDate)}</strong>
                </div>
              )}

              {/* 現在値 */}
              <div style={{ background: "#f5f0eb", borderRadius: 8, padding: "14px 20px", marginBottom: 16, border: "1px solid #c8a96e44" }}>
                <div style={{ fontSize: "0.75rem", color: "#7a5c2e", fontWeight: 700, marginBottom: 6 }}>{info.label}</div>
                <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#1a1208" }}>{curVal}</div>
              </div>

              <p style={{ fontSize: "0.88rem", color: "#333", marginBottom: 16, fontWeight: 600 }}>この内容で正しいですか？</p>

              <div style={{ display: "flex", gap: 10 }}>
                {/* ① 前のステップへ戻るボタン */}
                {!isFirst && (
                  <button onClick={goPrev}
                    style={{ flex: "0 0 auto", background: "transparent", color: "#7a5c2e", border: "2px solid #c8a96e", borderRadius: 6, padding: "11px 16px", cursor: "pointer", fontFamily: "inherit", fontSize: "0.88rem", fontWeight: 700 }}>
                    ← 前へ
                  </button>
                )}
                <button onClick={goNext}
                  style={{ flex: 1, background: "#2ecc71", color: "#fff", border: "none", borderRadius: 6, padding: "12px 0", cursor: "pointer", fontFamily: "inherit", fontSize: "0.95rem", fontWeight: 700 }}>
                  ✅ このまま次へ
                </button>
                <button onClick={startEdit}
                  style={{ flex: 1, background: "#e67e22", color: "#fff", border: "none", borderRadius: 6, padding: "12px 0", cursor: "pointer", fontFamily: "inherit", fontSize: "0.95rem", fontWeight: 700 }}>
                  ✏️ 修正する
                </button>
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: "0.88rem", color: "#e67e22", fontWeight: 700, marginBottom: 14 }}>
                ✏️ {info.label}を修正してください
              </p>

              {/* 支払期限・施行日：施行日ヒント表示 */}
              {info.key === "dueDate" && (
                <div style={{ background: "#f0f5f1", border: "1px solid #2d5a3d33", borderRadius: 6, padding: "7px 14px", marginBottom: 10, fontSize: "0.8rem", color: "#2d5a3d" }}>
                  🏛 施行日（参考）：<strong>{toJP(form.workDate)}</strong>
                </div>
              )}

              {info.type === "date" && (
                <input type="date"
                  style={{ width: "100%", border: "2px solid #c8a96e", borderRadius: 6, padding: "10px 14px", fontFamily: "inherit", fontSize: "1rem", marginBottom: 14, boxSizing: "border-box" }}
                  value={tmpDate} onChange={(e) => setTmpDate(e.target.value)} />
              )}

              {/* ③ 件名：マスター選択 + 手入力 両対応 */}
              {info.type === "subject" && (
                <div style={{ marginBottom: 14 }}>
                  <select
                    style={{ width: "100%", border: "2px solid #c8a96e", borderRadius: 6, padding: "10px 14px", fontFamily: "inherit", fontSize: "0.9rem", background: "#fffdf9", marginBottom: 8, boxSizing: "border-box" }}
                    value=""
                    onChange={(e) => { if (e.target.value) setTmpText(e.target.value); }}>
                    <option value="">📋 マスターから選択...</option>
                    {(subjects || []).map((s) => (
                      <option key={s.id} value={s.text}>{s.text}</option>
                    ))}
                  </select>
                  <input type="text"
                    style={{ width: "100%", border: "2px solid #c8a96e", borderRadius: 6, padding: "10px 14px", fontFamily: "inherit", fontSize: "1rem", boxSizing: "border-box" }}
                    placeholder="または直接入力"
                    value={tmpText} onChange={(e) => setTmpText(e.target.value)} />
                </div>
              )}

              {info.type === "client" && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <input type="text"
                      style={{ flex: 1, border: "2px solid #c8a96e", borderRadius: 6, padding: "10px 14px", fontFamily: "inherit", fontSize: "1rem", boxSizing: "border-box" }}
                      value={tmpClient} onChange={(e) => setTmpClient(e.target.value)} placeholder="会社名または氏名" />
                    <select
                      style={{ border: "2px solid #c8a96e", borderRadius: 6, padding: "10px 12px", fontFamily: "inherit", fontSize: "1rem", fontWeight: 700, background: "#fffdf9" }}
                      value={tmpHonorific} onChange={(e) => setTmpHonorific(e.target.value)}>
                      <option value="御中">御中</option>
                      <option value="様">様</option>
                    </select>
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "#888" }}>プレビュー：{tmpClient}　{tmpHonorific}</div>
                </div>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setEditing(false)}
                  style={{ flex: "0 0 auto", background: "#888", color: "#fff", border: "none", borderRadius: 6, padding: "12px 20px", cursor: "pointer", fontFamily: "inherit", fontSize: "0.9rem", fontWeight: 700 }}>
                  ← 戻る
                </button>
                <button onClick={saveAndNext}
                  style={{ flex: 1, background: "#1a1208", color: "#c8a96e", border: "none", borderRadius: 6, padding: "12px 0", cursor: "pointer", fontFamily: "inherit", fontSize: "0.95rem", fontWeight: 700 }}>
                  💾 修正して{isLast ? "完了" : "次へ"}
                </button>
              </div>
            </>
          )}

          {/* 最終ステップのスキップ */}
          {isLast && !editing && (
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <button onClick={() => onNext(null)}
                style={{ background: "transparent", color: "#aaa", border: "none", cursor: "pointer", fontSize: "0.8rem", fontFamily: "inherit" }}>
                すべての確認を終了する
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailModal({ doc, company, onClose, onEdit, onPrint }) {
  const { subtotal, discountAmt, total, partialPayment, remaining } = calcTotals(doc);
  const isInv  = doc.type === "invoice";
  const isEst  = doc.type === "estimate";
  const accent = isInv ? "#1a1208" : "#7a5c2e";
  const gold   = "#c8a96e";
  const filledItems = doc.items.filter((i) => i.name);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0007", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", borderRadius: 10, width: "100%", maxWidth: 760, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 8px 48px #0005", fontFamily: "inherit" }}>
        {/* ヘッダー */}
        <div style={{ background: accent, color: gold, padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", borderRadius: "10px 10px 0 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: "1.1rem", fontWeight: 700, letterSpacing: "0.1em" }}>{isInv ? "請求書" : "見積書"}</span>
            <span style={{ fontSize: "0.8rem", opacity: 0.8 }}>{doc.docNumber}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={S.btn(gold)} onClick={onPrint}>🖨 PDF出力</button>
            <button style={S.btn("#4a9e6e")} onClick={onEdit}>✏️ 編集</button>
            <button style={{ background: "transparent", color: "#fff", border: "none", cursor: "pointer", fontSize: "1.2rem", padding: "2px 8px" }} onClick={onClose}>✕</button>
          </div>
        </div>
        <div style={{ padding: "24px" }}>
          {/* 基本情報 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14, fontSize: "0.82rem" }}>
            {[["作成日", doc.createdAt], [isInv ? "支払期限" : "有効期限", doc.dueDate], ["施行日", doc.workDate || "—"], ["担当者", doc.staff], ["宛先", (doc.clientName || "") + "　" + (doc.honorific || "御中")], ["件名", doc.subject]].map(([l, v]) => (
              <div key={l} style={{ display: "flex", gap: 8 }}>
                <span style={{ color: "#7a5c2e", fontWeight: 700, whiteSpace: "nowrap", minWidth: 80 }}>{l}</span>
                <span>{v}</span>
              </div>
            ))}
          </div>
          {doc.note && <div style={{ fontSize: "0.8rem", color: "#666", marginBottom: 12 }}><span style={{ color: "#7a5c2e", fontWeight: 700, marginRight: 8 }}>備考</span>{doc.note}</div>}

          {/* 明細 */}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", marginBottom: 12 }}>
            <thead><tr>
              {[["品目","55%","left"],["数量","10%","center"],["単価","17%","right"],["金額","18%","right"]].map(([h,w,a]) => (
                <th key={h} style={{ background: accent, color: gold, padding: "6px 10px", textAlign: a, width: w, fontWeight: 600 }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filledItems.map((item, i) => {
                const { gross, itemDiscount, net } = itemAmounts(item);
                return (
                <tr key={i} style={{ background: i % 2 === 0 ? "#fffdf9" : "#f7f3ee" }}>
                  <td style={{ padding: "5px 10px", borderBottom: "1px solid #e0d8cc" }}>{item.name}</td>
                  <td style={{ padding: "5px 10px", borderBottom: "1px solid #e0d8cc", textAlign: "center" }}>{item.qty}</td>
                  <td style={{ padding: "5px 10px", borderBottom: "1px solid #e0d8cc", textAlign: "right" }}>¥ {fmt(item.price)}</td>
                  <td style={{ padding: "5px 10px", borderBottom: "1px solid #e0d8cc", textAlign: "right", fontWeight: 600 }}>
                    {isEst && itemDiscount > 0
                      ? <span><span style={{ textDecoration: "line-through", color: "#999", fontSize: "0.82em" }}>¥ {fmt(gross)}</span><br /><span style={{ color: "#c0392b" }}>¥ {fmt(net)}</span></span>
                      : `¥ ${fmt(gross)}`}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>

          {/* 合計 */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
            <table style={{ fontSize: "0.82rem", borderCollapse: "collapse", minWidth: 280 }}>
              <tbody>
                <tr><td style={{ padding: "4px 20px 4px 10px", color: "#666", borderBottom: "1px solid #e0d8cc" }}>小計</td><td style={{ padding: "4px 10px", textAlign: "right", borderBottom: "1px solid #e0d8cc", minWidth: 110 }}>¥ {fmt(subtotal)}</td></tr>
                {discountAmt > 0 && <tr><td style={{ padding: "4px 20px 4px 10px", color: "#c0392b", borderBottom: "1px solid #e0d8cc", fontWeight: isEst ? 600 : 400 }}>{isEst ? "値引き合計" : (doc.discountType === "%" ? `割引（${doc.discount}%）` : "値引")}</td><td style={{ padding: "4px 10px", textAlign: "right", borderBottom: "1px solid #e0d8cc", color: "#c0392b", fontWeight: isEst ? 600 : 400 }}>－¥ {fmt(discountAmt)}</td></tr>}
                <tr style={{ borderTop: "2px solid #c8a96e" }}><td style={{ padding: "7px 20px 7px 10px", fontWeight: 700, color: accent, fontSize: "0.9rem" }}>合計（税込）</td><td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, fontSize: "1rem" }}>¥ {fmt(total)}</td></tr>
                {isInv && partialPayment > 0 && <>
                  <tr><td style={{ padding: "4px 20px 4px 10px", color: "#2d6a9e", borderBottom: "1px solid #e0d8cc" }}>内入金済み</td><td style={{ padding: "4px 10px", textAlign: "right", borderBottom: "1px solid #e0d8cc", color: "#2d6a9e" }}>－¥ {fmt(partialPayment)}</td></tr>
                  <tr style={{ background: "#f0f7ff" }}><td style={{ padding: "8px 20px 8px 10px", fontWeight: 700, color: accent, fontSize: "0.95rem" }}>ご請求金額残</td><td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, fontSize: "1.05rem", color: accent }}>¥ {fmt(remaining)}</td></tr>
                </>}
              </tbody>
            </table>
          </div>

          {doc.specialNotes && (
            <div style={{ background: "#fffdf4", border: "1px solid #e0d8cc", borderRadius: 4, padding: "10px 14px", fontSize: "0.8rem", lineHeight: 1.8 }}>
              <div style={{ fontWeight: 700, color: "#7a5c2e", marginBottom: 4, fontSize: "0.76rem" }}>特記事項</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{doc.specialNotes}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// EDIT PANEL
// ============================================================
function EditPanel({ form, setField, setForm, setItem, clearItem, companies, staff, subjects, invoiceProducts, estimateProducts, docs, saveDoc, printPDF, setReportRow, clearReportRow, referralItems, reportClients, reportSubjects, onImportExcel }) {
  const isReport = form.type === "report_tax" || form.type === "report_notax";
  const products = form.type === "invoice" ? invoiceProducts : estimateProducts;
  const { subtotal, discountAmt, total, partialPayment, remaining } = isReport ? { subtotal:0,discountAmt:0,total:0,partialPayment:0,remaining:0 } : calcTotals(form);
  const company  = companies.find((c) => c.id === form.companyId) || companies[0] || {};
  const isInv    = form.type === "invoice";
  const isEst    = form.type === "estimate";

  return (
    <div>
      {/* 操作バー */}
      <div style={{ ...S.card, padding: "1rem 1.5rem", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, color: "#7a5c2e", fontSize: "0.85rem", whiteSpace: "nowrap" }}>書類種別:</span>
        {/* 請求書・見積書 */}
        {[["invoice","📄 請求書","#1a1208"],["estimate","📋 見積書","#7a5c2e"]].map(([v,l,col]) => (
          <label key={v} style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: "0.85rem",
            fontWeight: form.type === v ? 700 : 400, color: form.type === v ? col : "#666",
            background: form.type === v ? "#f5f0eb" : "transparent",
            border: `1px solid ${form.type === v ? col : "#d4c4a0"}`,
            borderRadius: 4, padding: "4px 12px", transition: "all .15s",
          }}>
            <input type="radio" style={{ accentColor: col }} checked={form.type === v}
              onChange={() => setForm((f) => ({ ...f, type: v, docNumber: formatDocNumber(v, docs) }))} /> {l}
          </label>
        ))}
        <span style={{ width: 1, height: 20, background: "#d4c4a0" }} />
        {/* 報告書 */}
        {[["report_tax","📊 報告書（税有）","#2d5a3d"],["report_notax","📊 報告書（税無）","#4a3d7a"]].map(([v,l,col]) => (
          <label key={v} style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: "0.85rem",
            fontWeight: form.type === v ? 700 : 400, color: form.type === v ? col : "#666",
            background: form.type === v ? "#f0f5f1" : "transparent",
            border: `1px solid ${form.type === v ? col : "#d4c4a0"}`,
            borderRadius: 4, padding: "4px 12px", transition: "all .15s",
          }}>
            <input type="radio" style={{ accentColor: col }} checked={form.type === v}
              onChange={() => setForm((f) => ({ ...f, type: v, reportNumber: formatDocNumber(v, docs) }))} /> {l}
          </label>
        ))}
        <div style={{ flex: 1 }} />
        {form.type === "invoice" && (
          <label title="XLS/Excelファイルから明細を自動入力（請求書のみ）" style={{ background: "#2d6a9e", color: "#fff", border: "none", borderRadius: 4, padding: "8px 16px", cursor: "pointer", fontFamily: "inherit", fontSize: "0.88rem", fontWeight: 700, letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: 6 }}>
            📂 Excelから読み込む
            <input type="file" accept=".xls,.xlsx,.XLS,.XLSX" style={{ display: "none" }} onChange={onImportExcel} />
          </label>
        )}
        <button style={S.btn("#2ecc71")} onClick={saveDoc}>💾 保存</button>
        <button style={S.btn("#1a1208")} onClick={() => printPDF(form)}>🖨 PDF出力</button>
      </div>

      {/* 報告書の場合は ReportEditPanel の中身を表示 */}
      {isReport && (
        <ReportEditPanel form={form} setField={setField} setReportRow={setReportRow} clearReportRow={clearReportRow}
          companies={companies} staff={staff} referralItems={referralItems}
          reportClients={reportClients} reportSubjects={reportSubjects}
          saveDoc={saveDoc} printPDF={printPDF}
          _skipOpBar={true} />
      )}

      {/* 請求書・見積書の場合のみ以下を表示 */}
      {!isReport && (<div>

      {/* 基本情報 */}
      <div style={S.card}>
        <div style={S.sectionTitle}>基本情報</div>
        <div style={S.grid4}>
          <div>
            <label style={S.label}>{isInv ? "請求書番号" : "見積書番号"}</label>
            <input style={S.input} value={form.docNumber} onChange={(e) => setField("docNumber", e.target.value)} />
          </div>
          <div>
            <label style={S.label}>作成日</label>
            <input type="date" style={S.input} value={form.createdAt} onChange={(e) => setField("createdAt", e.target.value)} />
          </div>
          <div>
            <label style={S.label}>{isInv ? "支払期限" : "見積期限"}</label>
            <input type="date" style={S.input} value={form.dueDate} onChange={(e) => setField("dueDate", e.target.value)} />
          </div>
          <div>
            <label style={S.label}>施行日</label>
            <input type="date" style={S.input} value={form.workDate || ""} onChange={(e) => setField("workDate", e.target.value)} />
          </div>
        </div>
        <div style={{ ...S.grid2, marginTop: "1rem" }}>
          <div>
            <label style={S.label}>発行会社</label>
            <select style={S.select} value={form.companyId} onChange={(e) => setField("companyId", Number(e.target.value))}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>作成者</label>
            <select style={S.select} value={form.staff} onChange={(e) => setField("staff", e.target.value)}>
              <option value="">選択してください</option>
              {staff.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* 案件情報 */}
      <div style={S.card}>
        <div style={S.sectionTitle}>案件情報</div>
        <div style={{ marginBottom: 10 }}>
          <label style={S.label}>宛先　<span style={{ fontSize: "0.72rem", color: "#aaa", fontWeight: 400 }}>（敬称は右側で選択）</span></label>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input style={{ ...S.input, flex: 1 }} placeholder="株式会社〇〇 または 山田 太郎" value={form.clientName} onChange={(e) => setField("clientName", e.target.value)} />
            <select style={{ ...S.select, flex: "0 0 auto", width: 80, fontWeight: 700, fontSize: "0.95rem", textAlign: "center" }}
              value={form.honorific || "御中"}
              onChange={(e) => setField("honorific", e.target.value)}>
              <option value="御中">御中</option>
              <option value="様">様</option>
            </select>
          </div>
        </div>
        <div style={S.grid2}>
          <div>
            <label style={S.label}>件名</label>
            <div style={{ display: "flex", gap: 4 }}>
              <select style={{ ...S.select, flex: "0 0 auto", width: 200, fontSize: "0.82rem" }} value=""
                onChange={(e) => { if (e.target.value) setField("subject", e.target.value); }}>
                <option value="">マスターから選択</option>
                {subjects.map((s) => <option key={s.id} value={s.text}>{s.text}</option>)}
              </select>
              <input style={{ ...S.input, flex: 1 }} placeholder="件名を直接入力" value={form.subject} onChange={(e) => setField("subject", e.target.value)} />
            </div>
          </div>
          <div>
            <label style={S.label}>但し書 / 備考</label>
            <input style={S.input} placeholder="上記の通り、ご請求申し上げます。" value={form.note} onChange={(e) => setField("note", e.target.value)} />
          </div>
        </div>
      </div>

      {/* 明細（商品マスターは書類種別で切替） */}
      <div style={S.card}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <div style={{ ...S.sectionTitle, margin: 0, flex: 1 }}>
            明細（最大10行）
          </div>
          <span style={{ fontSize: "0.75rem", color: "#7a5c2e", background: "#f5f0eb", padding: "3px 10px", borderRadius: 4, border: "1px solid #c8a96e55" }}>
            {isInv ? "📋 請求書用マスター" : "📋 見積書用マスター"}
          </span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={{ ...S.th, width: isEst ? "34%" : "55%" }}>品目</th>
            <th style={{ ...S.th, width: isEst ? "8%" : "10%", textAlign: "center" }}>数量</th>
            <th style={{ ...S.th, width: isEst ? "13%" : "16%", textAlign: "right" }}>単価（円）</th>
            {isEst && <th style={{ ...S.th, width: "20%", textAlign: "center" }}>値引き</th>}
            <th style={{ ...S.th, width: isEst ? "20%" : "14%", textAlign: "right" }}>金額（円）</th>
            <th style={{ ...S.th, width: "5%" }}></th>
          </tr></thead>
          <tbody>
            {form.items.map((item, idx) => (
              <ItemRow key={idx} item={item} idx={idx} products={products} onChange={setItem} onClear={clearItem} isEstimate={isEst} />
            ))}
          </tbody>
        </table>
      </div>

      {/* 割引・入金・合計 */}
      <div style={S.card}>
        <div style={S.sectionTitle}>{isEst ? "合計（値引きは各商品行で設定）" : `割引 / ${isInv ? "入金・" : ""}合計`}</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24, flexWrap: "wrap" }}>
          {/* 左：入力 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {!isEst && (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <label style={{ ...S.label, margin: 0, whiteSpace: "nowrap" }}>割引・値引:</label>
                <select style={{ ...S.select, width: 110 }} value={form.discountType} onChange={(e) => setField("discountType", e.target.value)}>
                  <option value="%">％ 割引</option>
                  <option value="¥">¥ 値引</option>
                </select>
                <input type="number" min="0" style={{ ...S.input, width: 120, textAlign: "right" }}
                  value={form.discount} onChange={(e) => setField("discount", e.target.value)} />
                <span style={{ color: "#7a5c2e", fontWeight: 700 }}>{form.discountType}</span>
              </div>
            )}
            {isEst && (
              <div style={{ fontSize: "0.78rem", color: "#7a5c2e", background: "#f5f0eb", padding: "8px 12px", borderRadius: 4, border: "1px solid #c8a96e55", maxWidth: 300 }}>
                💡 値引きは明細の各行で個別に設定できます。値引き合計が下に表示されます。
              </div>
            )}
            {isInv && (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <label style={{ ...S.label, margin: 0, whiteSpace: "nowrap" }}>内入金済み:</label>
                <input type="number" min="0" style={{ ...S.input, width: 150, textAlign: "right" }}
                  value={form.partialPayment || 0} onChange={(e) => setField("partialPayment", e.target.value)} />
                <span style={{ color: "#2d6a9e", fontWeight: 700 }}>円</span>
              </div>
            )}
          </div>

          {/* 右：合計表 */}
          <table style={{ fontSize: "0.88rem", borderCollapse: "collapse", minWidth: 290 }}>
            <tbody>
              <tr>
                <td style={{ padding: "4px 20px 4px 8px", color: "#666" }}>小計</td>
                <td style={{ padding: "4px 8px", textAlign: "right", minWidth: 115 }}>¥ {fmt(subtotal)}</td>
              </tr>
              {discountAmt > 0 && (
                <tr>
                  <td style={{ padding: "4px 20px 4px 8px", color: "#c0392b", fontWeight: isEst ? 600 : 400 }}>
                    {isEst ? "値引き合計" : (form.discountType === "%" ? `割引（${form.discount}%）` : "値引")}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: "#c0392b", fontWeight: isEst ? 600 : 400 }}>
                    {`－¥ ${fmt(discountAmt)}`}
                  </td>
                </tr>
              )}
              <tr style={{ borderTop: "2px solid #c8a96e" }}>
                <td style={{ padding: "8px 20px 8px 8px", fontWeight: 700, color: "#7a5c2e", fontSize: "0.95rem" }}>合計（税込）</td>
                <td style={{ padding: "8px 8px", textAlign: "right", fontWeight: 700, fontSize: "1.05rem" }}>¥ {fmt(total)}</td>
              </tr>
              {isInv && partialPayment > 0 && (
                <>
                  <tr>
                    <td style={{ padding: "4px 20px 4px 8px", color: "#2d6a9e" }}>内入金済み</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: "#2d6a9e" }}>－¥ {fmt(partialPayment)}</td>
                  </tr>
                  <tr style={{ background: "#f0f7ff", borderTop: "2px solid #2d6a9e" }}>
                    <td style={{ padding: "8px 20px 8px 8px", fontWeight: 700, color: "#2d6a9e", fontSize: "0.95rem" }}>ご請求金額残</td>
                    <td style={{ padding: "8px 8px", textAlign: "right", fontWeight: 700, fontSize: "1.1rem", color: "#2d6a9e" }}>¥ {fmt(remaining)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 特記事項 */}
      <div style={S.card}>
        <div style={S.sectionTitle}>特記事項</div>
        <textarea style={{ ...S.input, height: 120, resize: "vertical", lineHeight: 1.8 }}
          placeholder={"特記事項を入力（5行程度）\n例：納品後30日以内のお支払いをお願いします。"}
          value={form.specialNotes || ""} onChange={(e) => setField("specialNotes", e.target.value)} />
        <div style={{ fontSize: "0.72rem", color: "#aaa", marginTop: 4 }}>※ PDF出力時に5行の罫線枠に表示されます</div>
      </div>

      {/* 発行元確認 */}
      <div style={{ ...S.card, background: "#fffdf4" }}>
        <div style={S.sectionTitle}>発行元情報（確認）</div>
        {company.name
          ? <div style={{ fontSize: "0.85rem", lineHeight: 1.9 }}>
              <strong>{company.name}</strong><br />
              {company.postal} {company.address}<br />
              TEL: {company.tel} / FAX: {company.fax} / {company.email}<br />
              {isInv && <span style={{ color: "#7a5c2e" }}>振込先: {company.bank}</span>}
            </div>
          : <p style={{ color: "#aaa" }}>マスター管理から会社情報を設定してください。</p>}
      </div>

      {/* 編集履歴 */}
      {(form.editLog && form.editLog.length > 0) && (
        <div style={S.card}>
          <div style={S.sectionTitle}>編集履歴（最新順）</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: 160, whiteSpace: "nowrap" }}>日時</th>
                <th style={S.th}>変更内容</th>
              </tr>
            </thead>
            <tbody>
              {form.editLog.map((log, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "#fffdf9" : "#f7f3ee", verticalAlign: "top" }}>
                  <td style={{ ...S.td, whiteSpace: "nowrap", color: "#7a5c2e", fontWeight: 600 }}>{log.at}</td>
                  <td style={S.td}>
                    {log.changes.map((c, j) => (
                      <div key={j} style={{ padding: "1px 0", borderBottom: j < log.changes.length - 1 ? "1px dashed #e8d9c0" : "none", fontSize: "0.8rem" }}>
                        {c}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 下部 保存ボタン */}
      <div style={{ ...S.card, padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12 }}>
        <span style={{ fontSize: "0.82rem", color: "#aaa" }}>入力が完了したら保存してください</span>
        <button style={{ ...S.btn("#2ecc71"), padding: "10px 32px", fontSize: "1rem" }} onClick={saveDoc}>💾 保存</button>
        <button style={{ ...S.btn("#1a1208"), padding: "10px 24px", fontSize: "1rem" }} onClick={() => printPDF(form)}>🖨 PDF出力</button>
      </div>
      </div>)}
    </div>
  );
}

// ============================================================
// HISTORY PANEL
// ============================================================
// ── 共通フィルター+テーブルコンポーネント ──
function HistoryTable({ docs, types, accentColor, labelFn, numberKey, amountFn, onView, onEdit, onTrash }) {
  const [fRptType, setFRptType] = useState("all"); // 報告書用サブフィルター
  const [fMonth,   setFMonth]   = useState("");
  const [fStaff,   setFStaff]   = useState("");
  const [fWorkYM,  setFWorkYM]  = useState("");
  const [fSubject, setFSubject] = useState("");

  const isReport = types.includes("report_tax");
  const base = docs.filter((d) => types.includes(d.type));

  const months      = [...new Set(base.map((d) => ym(d.createdAt)).filter(Boolean))].sort().reverse();
  const workYMs     = [...new Set(base.map((d) => ym(d.workDate || "")).filter(Boolean))].sort().reverse();
  const staffList   = [...new Set(base.map((d) => d.staff).filter(Boolean))];
  const subjectList = [...new Set(base.map((d) => d.subject).filter(Boolean))].sort();

  const filtered = [...base]
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .filter((d) => {
      if (isReport && fRptType !== "all" && d.type !== fRptType) return false;
      if (fMonth   && ym(d.createdAt)        !== fMonth)   return false;
      if (fStaff   && d.staff                !== fStaff)   return false;
      if (fWorkYM  && ym(d.workDate || "")   !== fWorkYM)  return false;
      if (fSubject && d.subject              !== fSubject)  return false;
      return true;
    });

  const resetAll = () => { setFRptType("all"); setFMonth(""); setFStaff(""); setFWorkYM(""); setFSubject(""); };

  return (
    <div>
      {/* フィルターカード */}
      <div style={{ ...S.card, borderTop: `3px solid ${accentColor}` }}>
        <div style={{ ...S.sectionTitle, color: accentColor, borderBottomColor: accentColor }}>フィルター</div>
        <div style={{ display: "grid", gridTemplateColumns: isReport ? "1fr 1fr 1fr 1fr 1fr" : "1fr 1fr 1fr 1fr", gap: "1rem" }}>
          {isReport && (
            <div>
              <label style={{ ...S.label, color: accentColor === "#2d5a3d" ? "#2d5a3d" : "#4a3d7a" }}>税区分</label>
              <select style={S.select} value={fRptType} onChange={(e) => setFRptType(e.target.value)}>
                <option value="all">すべて</option>
                <option value="report_tax">税有</option>
                <option value="report_notax">税無</option>
              </select>
            </div>
          )}
          <div>
            <label style={S.label}>作成年月</label>
            <select style={S.select} value={fMonth} onChange={(e) => setFMonth(e.target.value)}>
              <option value="">すべて</option>{months.map((m) => <option key={m} value={m}>{ymLabel(m)}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>担当者</label>
            <select style={S.select} value={fStaff} onChange={(e) => setFStaff(e.target.value)}>
              <option value="">すべて</option>{staffList.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>施行年月</label>
            <select style={S.select} value={fWorkYM} onChange={(e) => setFWorkYM(e.target.value)}>
              <option value="">すべて</option>{workYMs.map((m) => <option key={m} value={m}>{ymLabel(m)}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>件名</label>
            <select style={S.select} value={fSubject} onChange={(e) => setFSubject(e.target.value)}>
              <option value="">すべて</option>{subjectList.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12 }}>
          <button style={S.btnSm("#888")} onClick={resetAll}>リセット</button>
          <span style={{ fontSize: "0.8rem", color: "#999" }}>{filtered.length} 件表示</span>
        </div>
      </div>

      {/* 一覧カード */}
      <div style={{ ...S.card, borderTop: `3px solid ${accentColor}` }}>
        {filtered.length === 0 && (
          <p style={{ color: "#aaa", textAlign: "center", padding: "2rem 0" }}>
            {base.length === 0 ? "まだ保存された書類はありません。" : "条件に一致する書類がありません。"}
          </p>
        )}
        {filtered.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ background: accentColor }}>
                {isReport && <th style={{ ...S.th, background: accentColor, color: "#c8a96e" }}>種別</th>}
                <th style={{ ...S.th, background: accentColor, color: "#c8a96e" }}>番号</th>
                <th style={{ ...S.th, background: accentColor, color: "#c8a96e" }}>作成日</th>
                <th style={{ ...S.th, background: accentColor, color: "#c8a96e" }}>施行日</th>
                <th style={{ ...S.th, background: accentColor, color: "#c8a96e" }}>担当者</th>
                <th style={{ ...S.th, background: accentColor, color: "#c8a96e" }}>宛先</th>
                <th style={{ ...S.th, background: accentColor, color: "#c8a96e" }}>件名</th>
                <th style={{ ...S.th, background: accentColor, color: "#c8a96e", textAlign: "right" }}>金額</th>
                <th style={{ ...S.th, background: accentColor, color: "#c8a96e", textAlign: "center", width: 156 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d, i) => {
                const amount = amountFn(d);
                const numStr = d.reportNumber || d.docNumber || "—";
                const typeLabel = d.type === "invoice" ? "請求書" : d.type === "estimate" ? "見積書" : d.type === "report_tax" ? "税有" : "税無";
                const typeBg   = d.type === "report_tax" ? "#2d5a3d" : "#4a3d7a";
                return (
                  <tr key={d.id} style={{ background: i % 2 === 0 ? "#fffdf9" : "#f7f3ee" }}>
                    {isReport && (
                      <td style={S.td}>
                        <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: "0.72rem", fontWeight: 700, background: typeBg, color: "#c8a96e" }}>{typeLabel}</span>
                      </td>
                    )}
                    <td style={{ ...S.td, whiteSpace: "nowrap", fontSize: "0.78rem" }}>{numStr}</td>
                    <td style={{ ...S.td, whiteSpace: "nowrap" }}>{d.createdAt}</td>
                    <td style={{ ...S.td, whiteSpace: "nowrap", color: accentColor }}>{d.workDate || "—"}</td>
                    <td style={S.td}>{d.staff}</td>
                    <td style={S.td}>{d.clientName}</td>
                    <td style={S.td}>{d.subject}</td>
                    <td style={{ ...S.td, textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>¥ {fmt(amount)}</td>
                    <td style={{ ...S.td, textAlign: "center", whiteSpace: "nowrap" }}>
                      <button style={{ ...S.btnSm("#4a7c9e"), marginRight: 4 }} onClick={() => onView(d)}>確認</button>
                      <button style={{ ...S.btnSm(), marginRight: 4 }} onClick={() => onEdit(d)}>編集</button>
                      <button style={S.btnSm("#c0392b")} onClick={() => onTrash(d.id)}>🗑</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function HistoryPanel({ docs, calcTotals, onView, onEdit, onTrash }) {
  const [histTab, setHistTab] = useState("invoice");

  const invDocs = docs.filter((d) => d.type === "invoice");
  const estDocs = docs.filter((d) => d.type === "estimate");
  const rptDocs = docs.filter((d) => d.type === "report_tax" || d.type === "report_notax");

  const invAmount = (d) => calcTotals(d).total;
  const estAmount = (d) => calcTotals(d).total;
  const rptAmount = (d) => { const r = calcReport(d.reportItems||[], d.type); return r.rebateWithTax || r.totalRebate; };

  // タブスタイル
  const tabBtn = (key, label, color, count) => (
    <button key={key} onClick={() => setHistTab(key)} style={{
      background: histTab === key ? color : "#fff",
      color: histTab === key ? "#fff" : color,
      border: `2px solid ${color}`,
      borderRadius: "6px 6px 0 0",
      padding: "10px 24px",
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: "0.88rem",
      fontWeight: 700,
      letterSpacing: "0.05em",
      borderBottom: histTab === key ? `2px solid ${color}` : "2px solid #e8d9c0",
      transition: "all .18s",
      display: "flex",
      alignItems: "center",
      gap: 8,
    }}>
      {label}
      <span style={{
        background: histTab === key ? "rgba(255,255,255,0.25)" : color,
        color: histTab === key ? "#fff" : "#fff",
        borderRadius: 10, fontSize: "0.72rem",
        padding: "1px 8px", fontWeight: 700,
      }}>{count}</span>
    </button>
  );

  return (
    <div>
      {/* 履歴タブ */}
      <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #e8d9c0", marginBottom: 0 }}>
        {tabBtn("invoice",  "📄 請求書",   "#1a1208", invDocs.length)}
        {tabBtn("estimate", "📋 見積書",   "#7a5c2e", estDocs.length)}
        {tabBtn("report",   "📊 報告書",   "#2d5a3d", rptDocs.length)}
      </div>

      <div style={{ marginTop: 0 }}>
        {histTab === "invoice" && (
          <HistoryTable docs={docs} types={["invoice"]} accentColor="#1a1208"
            amountFn={invAmount} onView={onView} onEdit={onEdit} onTrash={onTrash} />
        )}
        {histTab === "estimate" && (
          <HistoryTable docs={docs} types={["estimate"]} accentColor="#7a5c2e"
            amountFn={estAmount} onView={onView} onEdit={onEdit} onTrash={onTrash} />
        )}
        {histTab === "report" && (
          <HistoryTable docs={docs} types={["report_tax","report_notax"]} accentColor="#2d5a3d"
            amountFn={rptAmount} onView={onView} onEdit={onEdit} onTrash={onTrash} />
        )}
      </div>
    </div>
  );
}


// ============================================================
// TRASH PANEL
// ============================================================
function TrashPanel({ trash, calcTotals, onRestore }) {
  return (
    <div>
      <div style={{ ...S.card, background: "#fff8f8", border: "1px solid #f0d0d0" }}>
        <div style={{ ...S.sectionTitle, color: "#c0392b", borderBottomColor: "#f0d0d0" }}>
          🗑 ゴミ箱
        </div>
        <p style={{ fontSize: "0.82rem", color: "#888", marginBottom: 14 }}>
          ゴミ箱内の書類は削除できません。「元に戻す」で履歴に復元できます。
        </p>
        {trash.length === 0 && (
          <p style={{ color: "#ccc", textAlign: "center", padding: "2rem 0" }}>ゴミ箱は空です。</p>
        )}
        {trash.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead><tr>
              <th style={S.th}>種別</th>
              <th style={S.th}>番号</th>
              <th style={S.th}>作成日</th>
              <th style={S.th}>担当者</th>
              <th style={S.th}>宛先</th>
              <th style={S.th}>件名</th>
              <th style={{ ...S.th, textAlign: "right" }}>合計</th>
              <th style={{ ...S.th, whiteSpace: "nowrap" }}>移動日時</th>
              <th style={{ ...S.th, textAlign: "center", width: 100 }}>操作</th>
            </tr></thead>
            <tbody>
              {trash.map((d, i) => {
                const { total } = calcTotals(d);
                return (
                  <tr key={d.id} style={{ background: i % 2 === 0 ? "#fff8f8" : "#fdf0f0" }}>
                    <td style={S.td}><span style={S.tag(d.type)}>{d.type === "invoice" ? "請求書" : "見積書"}</span></td>
                    <td style={{ ...S.td, whiteSpace: "nowrap", color: "#999" }}>{d.docNumber}</td>
                    <td style={{ ...S.td, whiteSpace: "nowrap", color: "#999" }}>{d.createdAt}</td>
                    <td style={{ ...S.td, color: "#999" }}>{d.staff}</td>
                    <td style={{ ...S.td, color: "#999" }}>{d.clientName}</td>
                    <td style={{ ...S.td, color: "#999" }}>{d.subject}</td>
                    <td style={{ ...S.td, textAlign: "right", color: "#999" }}>¥ {fmt(total)}</td>
                    <td style={{ ...S.td, whiteSpace: "nowrap", fontSize: "0.76rem", color: "#c0392b" }}>{d.trashedAt}</td>
                    <td style={{ ...S.td, textAlign: "center" }}>
                      <button style={S.btnSm("#2d6a9e")} onClick={() => onRestore(d.id)}>↩ 元に戻す</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ============================================================
// SORTABLE TABLE  ★ 件名・作成者・ご紹介内容マスター共通の並び替えテーブル
// fieldKey: データの表示/編集フィールド名（"text" or "name"）
// ============================================================
function SortableTable({ items, setItems, editId, setEditId, fieldKey, addLabel, newVal }) {
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOver, setDragOver] = useState(null);

  const moveUp   = (idx) => { if (idx === 0) return; const a = [...items]; [a[idx-1], a[idx]] = [a[idx], a[idx-1]]; setItems(a); };
  const moveDown = (idx) => { if (idx === items.length - 1) return; const a = [...items]; [a[idx], a[idx+1]] = [a[idx+1], a[idx]]; setItems(a); };

  const onDragStart = (idx) => setDragIdx(idx);
  const onDragEnter = (idx) => setDragOver(idx);
  const onDragEnd   = () => {
    if (dragIdx === null || dragOver === null || dragIdx === dragOver) { setDragIdx(null); setDragOver(null); return; }
    const a = [...items];
    const [moved] = a.splice(dragIdx, 1);
    a.splice(dragOver, 0, moved);
    setItems(a);
    setDragIdx(null);
    setDragOver(null);
  };

  return (
    <div>
      <div style={{ fontSize: "0.76rem", color: "#7a5c2e", marginBottom: 8 }}>
        <span style={{ background: "#f5f0eb", border: "1px solid #c8a96e55", borderRadius: 3, padding: "2px 8px" }}>
          ☰ 行をドラッグ、または ▲▼ で並び替えできます
        </span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
        <thead><tr>
          <th style={{ ...S.th, width: 32 }}></th>
          <th style={S.th}>項目</th>
          <th style={{ ...S.th, width: 140 }}></th>
        </tr></thead>
        <tbody>
          {items.map((item, idx) => {
            const isDragging = dragIdx === idx;
            const isOver     = dragOver === idx;
            const rowBg = isDragging ? "#e8d9c0" : isOver ? "#f0ebe0" : idx % 2 === 0 ? "#fffdf9" : "#f7f3ee";
            return (
              <tr key={item.id}
                draggable
                onDragStart={() => onDragStart(idx)}
                onDragEnter={() => onDragEnter(idx)}
                onDragEnd={onDragEnd}
                onDragOver={(e) => e.preventDefault()}
                style={{ background: rowBg, opacity: isDragging ? 0.5 : 1, outline: isOver ? "2px solid #c8a96e" : "none" }}
              >
                {/* ▲▼ + ドラッグハンドル */}
                <td style={{ ...S.td, textAlign: "center", padding: "4px 6px", cursor: "grab" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                    <button style={{ background: "none", border: "none", cursor: "pointer", color: "#7a5c2e", fontSize: "0.7rem", padding: "1px 4px", lineHeight: 1 }} onClick={() => moveUp(idx)}>▲</button>
                    <span style={{ fontSize: "0.85rem", color: "#ccc" }}>☰</span>
                    <button style={{ background: "none", border: "none", cursor: "pointer", color: "#7a5c2e", fontSize: "0.7rem", padding: "1px 4px", lineHeight: 1 }} onClick={() => moveDown(idx)}>▼</button>
                  </div>
                </td>
                {editId === item.id ? (
                  <>
                    <td style={S.td}>
                      <input style={S.input} value={item[fieldKey]}
                        onChange={(e) => setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, [fieldKey]: e.target.value } : x))} />
                    </td>
                    <td style={S.td}><button style={S.btnSm()} onClick={() => setEditId(null)}>完了</button></td>
                  </>
                ) : (
                  <>
                    <td style={S.td}>{item[fieldKey]}</td>
                    <td style={S.td}>
                      <button style={{ ...S.btnSm(), marginRight: 6 }} onClick={() => setEditId(item.id)}>編集</button>
                      <button style={S.btnSm("#c0392b")} onClick={() => setItems((prev) => prev.filter((x) => x.id !== item.id))}>削除</button>
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ marginTop: 10 }}>
        <button style={S.btn()} onClick={() => setItems((p) => [...p, { id: Date.now(), [fieldKey]: newVal }])}>＋ {addLabel}</button>
      </div>
    </div>
  );
}

// ============================================================
// PRODUCT TABLE  ★ MasterPanel の外で定義（再マウント防止）
// ドラッグ&ドロップ + ▲▼ボタンで並び替え可能
// ============================================================
function ProductTable({ products, setProducts, editId, setEditId }) {
  const { useState: useLocalState } = window.React || {};
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOver, setDragOver] = useState(null);

  // ▲▼ ボタンによる移動
  const moveUp   = (idx) => { if (idx === 0) return; const a = [...products]; [a[idx-1], a[idx]] = [a[idx], a[idx-1]]; setProducts(a); };
  const moveDown = (idx) => { if (idx === products.length - 1) return; const a = [...products]; [a[idx], a[idx+1]] = [a[idx+1], a[idx]]; setProducts(a); };

  // ドラッグ&ドロップ
  const onDragStart = (idx) => setDragIdx(idx);
  const onDragEnter = (idx) => setDragOver(idx);
  const onDragEnd   = () => {
    if (dragIdx === null || dragOver === null || dragIdx === dragOver) { setDragIdx(null); setDragOver(null); return; }
    const a = [...products];
    const [moved] = a.splice(dragIdx, 1);
    a.splice(dragOver, 0, moved);
    setProducts(a);
    setDragIdx(null);
    setDragOver(null);
  };

  return (
    <div>
      <div style={{ fontSize: "0.76rem", color: "#7a5c2e", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ background: "#f5f0eb", border: "1px solid #c8a96e55", borderRadius: 3, padding: "2px 8px" }}>
          ☰ 行をドラッグ、または ▲▼ ボタンで並び替えできます
        </span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
        <thead><tr>
          <th style={{ ...S.th, width: 32 }}></th>
          <th style={S.th}>商品名</th>
          <th style={{ ...S.th, width: 140, textAlign: "right" }}>標準単価</th>
          <th style={{ ...S.th, width: 160 }}></th>
        </tr></thead>
        <tbody>
          {products.map((p, idx) => {
            const isDragging = dragIdx === idx;
            const isOver     = dragOver === idx;
            const rowBg = isDragging ? "#e8d9c0" : isOver ? "#f0ebe0" : idx % 2 === 0 ? "#fffdf9" : "#f7f3ee";
            return (
              <tr
                key={p.id}
                draggable
                onDragStart={() => onDragStart(idx)}
                onDragEnter={() => onDragEnter(idx)}
                onDragEnd={onDragEnd}
                onDragOver={(e) => e.preventDefault()}
                style={{ background: rowBg, opacity: isDragging ? 0.5 : 1, transition: "background 0.15s", outline: isOver ? "2px solid #c8a96e" : "none" }}
              >
                {/* ドラッグハンドル + ▲▼ */}
                <td style={{ ...S.td, textAlign: "center", cursor: "grab", color: "#bbb", userSelect: "none", padding: "4px 6px" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                    <button style={{ background: "none", border: "none", cursor: "pointer", color: "#7a5c2e", fontSize: "0.7rem", padding: "1px 4px", lineHeight: 1 }} onClick={() => moveUp(idx)} title="上へ">▲</button>
                    <span style={{ fontSize: "0.85rem", color: "#ccc" }}>☰</span>
                    <button style={{ background: "none", border: "none", cursor: "pointer", color: "#7a5c2e", fontSize: "0.7rem", padding: "1px 4px", lineHeight: 1 }} onClick={() => moveDown(idx)} title="下へ">▼</button>
                  </div>
                </td>
                {editId === p.id ? (
                  <>
                    <td style={S.td}><input style={S.input} value={p.name} onChange={(e) => setProducts((prev) => prev.map((x) => x.id === p.id ? { ...x, name: e.target.value } : x))} /></td>
                    <td style={S.td}><input type="number" style={{ ...S.input, textAlign: "right" }} value={p.price} onChange={(e) => setProducts((prev) => prev.map((x) => x.id === p.id ? { ...x, price: Number(e.target.value) } : x))} /></td>
                    <td style={S.td}><button style={S.btnSm()} onClick={() => setEditId(null)}>完了</button></td>
                  </>
                ) : (
                  <>
                    <td style={S.td}>{p.name}</td>
                    <td style={{ ...S.td, textAlign: "right" }}>¥ {fmt(p.price)}</td>
                    <td style={S.td}>
                      <button style={{ ...S.btnSm(), marginRight: 6 }} onClick={() => setEditId(p.id)}>編集</button>
                      <button style={S.btnSm("#c0392b")} onClick={() => setProducts((prev) => prev.filter((x) => x.id !== p.id))}>削除</button>
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ marginTop: 10 }}>
        <button style={S.btn()} onClick={() => setProducts((p) => [...p, { id: Date.now(), name: "新商品", price: 0 }])}>＋ 商品追加</button>
      </div>
    </div>
  );
}

// ============================================================
// MASTER PANEL（請求書用・見積書用で商品マスターを分離）
// ============================================================
function MasterPanel({ companies, setCompanies, invoiceProducts, setInvoiceProducts, estimateProducts, setEstimateProducts, staff, setStaff, subjects, setSubjects, referralItems, setReferralItems, reportClients, setReportClients, reportSubjects, setReportSubjects, onPush, onPull, syncing, fbStatus }) {
  const [activeM,  setActiveM]  = useState("company");
  const [editC,    setEditC]    = useState(null);
  const [editIP,   setEditIP]   = useState(null);
  const [editEP,   setEditEP]   = useState(null);
  const [editSt,   setEditSt]   = useState(null);
  const [editSubj, setEditSubj] = useState(null);
  const [editRef,  setEditRef]  = useState(null);
  const [invSubTab, setInvSubTab] = useState("products");
  const [estSubTab, setEstSubTab] = useState("products");
  const [rptSubTab, setRptSubTab] = useState("clients");
  const [editRC, setEditRC] = useState(null);
  const [editRS, setEditRS] = useState(null);

  return (
    <div style={S.card}>
      {/* ── 同期バナー ── */}
      <div style={{ background: "#f0f5f1", border: "1px solid #2d5a3d44", borderRadius: 8, padding: "12px 20px", marginBottom: 20, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#2d5a3d", marginBottom: 3 }}>🔄 マスター情報の共有</div>
          <div style={{ fontSize: "0.76rem", color: "#555", lineHeight: 1.6 }}>
            編集後は「📤 全端末に反映」を押すと他のPCに共有されます。<br />
            他の端末で変更があった場合は「📥 最新を取得」で更新してください。
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: "0.72rem", padding: "2px 8px", borderRadius: 10, fontWeight: 700,
            background: fbStatus === "online" ? "#2ecc71" : "#e74c3c", color: "#fff" }}>
            {fbStatus === "online" ? "🟢 接続中" : "🔴 オフライン"}
          </span>
          <button onClick={onPull} disabled={syncing || fbStatus !== "online"}
            style={{ background: "#2d6a9e", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px",
              cursor: (syncing || fbStatus !== "online") ? "not-allowed" : "pointer",
              fontFamily: "inherit", fontSize: "0.82rem", fontWeight: 700, opacity: (syncing || fbStatus !== "online") ? 0.5 : 1 }}>
            {syncing ? "⏳ 処理中..." : "📥 最新を取得"}
          </button>
          <button onClick={onPush} disabled={syncing || fbStatus !== "online"}
            style={{ background: "#2d5a3d", color: "#c8a96e", border: "none", borderRadius: 6, padding: "8px 16px",
              cursor: (syncing || fbStatus !== "online") ? "not-allowed" : "pointer",
              fontFamily: "inherit", fontSize: "0.82rem", fontWeight: 700, opacity: (syncing || fbStatus !== "online") ? 0.5 : 1 }}>
            {syncing ? "⏳ 処理中..." : "📤 全端末に反映"}
          </button>
        </div>
      </div>

      {/* タブ */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {[["company","会社情報"],["inv","請求書"],["est","見積書"],["rpt","報告書"]].map(([k,l]) => (
          <button key={k} style={S.navBtn(activeM === k)} onClick={() => setActiveM(k)}>{l}</button>
        ))}
      </div>

      {/* 会社情報 */}
      {activeM === "company" && (
        <div>
          <div style={S.sectionTitle}>会社情報マスター（共通）</div>
          {companies.map((c) => (
            <div key={c.id} style={{ border: "1px solid #e8d9c0", borderRadius: 6, padding: "1rem", marginBottom: 10 }}>
              {editC === c.id ? (
                <div>
                  {[["name","会社名"],["postal","郵便番号"],["address","住所"],["tel","TEL"],["fax","FAX"],["email","Email"],["bank","振込先"],["invoiceNo","インボイス番号"]].map(([k,l]) => (
                    <div key={k} style={{ marginBottom: 8 }}>
                      <label style={S.label}>{l}</label>
                      <input style={S.input} value={c[k] || ""} onChange={(e) => setCompanies((prev) => prev.map((x) => x.id === c.id ? { ...x, [k]: e.target.value } : x))} />
                    </div>
                  ))}
                  <button style={S.btn()} onClick={() => setEditC(null)}>完了</button>
                </div>
              ) : (
                <div style={S.row}>
                  <div style={{ flex: 1 }}><strong>{c.name}</strong><span style={{ fontSize: "0.8rem", color: "#777", marginLeft: 12 }}>{c.address} / {c.tel}</span></div>
                  <button style={S.btnSm()} onClick={() => setEditC(c.id)}>編集</button>
                  <button style={S.btnSm("#c0392b")} onClick={() => setCompanies((p) => p.filter((x) => x.id !== c.id))}>削除</button>
                </div>
              )}
            </div>
          ))}
          <button style={S.btn()} onClick={() => setCompanies((p) => [...p, { id: Date.now(), name: "新会社", postal: "", address: "", tel: "", fax: "", email: "", bank: "", invoiceNo: "" }])}>＋ 会社追加</button>
        </div>
      )}

      {/* 請求書マスター */}
      {activeM === "inv" && (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {[["products","商品マスター"],["subjects","件名"],["staff","作成者"]].map(([k,l]) => (
              <button key={k} style={{ background: invSubTab===k?"#1a1208":"transparent", color: invSubTab===k?"#c8a96e":"#1a1208", border:"1px solid #1a120844", borderRadius:4, padding:"6px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:"0.82rem", fontWeight:700, transition:"all .2s" }} onClick={() => setInvSubTab(k)}>{l}</button>
            ))}
          </div>
          {invSubTab === "products" && (
            <div><div style={S.sectionTitle}>請求書用 商品マスター</div>
              <ProductTable products={invoiceProducts} setProducts={setInvoiceProducts} editId={editIP} setEditId={setEditIP} />
            </div>
          )}
          {invSubTab === "subjects" && (
            <div><div style={S.sectionTitle}>件名マスター（請求書用）</div>
              <SortableTable items={subjects} setItems={setSubjects} editId={editSubj} setEditId={setEditSubj} fieldKey="text" addLabel="件名追加" newVal="新しい件名" />
            </div>
          )}
          {invSubTab === "staff" && (
            <div><div style={S.sectionTitle}>作成者マスター（共通）</div>
              <SortableTable items={staff} setItems={setStaff} editId={editSt} setEditId={setEditSt} fieldKey="name" addLabel="担当者追加" newVal="新担当者" />
            </div>
          )}
        </div>
      )}

      {/* 見積書マスター */}
      {activeM === "est" && (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {[["products","商品マスター"],["subjects","件名"],["staff","作成者"]].map(([k,l]) => (
              <button key={k} style={{ background: estSubTab===k?"#7a5c2e":"transparent", color: estSubTab===k?"#c8a96e":"#7a5c2e", border:"1px solid #7a5c2e44", borderRadius:4, padding:"6px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:"0.82rem", fontWeight:700, transition:"all .2s" }} onClick={() => setEstSubTab(k)}>{l}</button>
            ))}
          </div>
          {estSubTab === "products" && (
            <div><div style={S.sectionTitle}>見積書用 商品マスター</div>
              <ProductTable products={estimateProducts} setProducts={setEstimateProducts} editId={editEP} setEditId={setEditEP} />
            </div>
          )}
          {estSubTab === "subjects" && (
            <div><div style={S.sectionTitle}>件名マスター（見積書用）</div>
              <SortableTable items={subjects} setItems={setSubjects} editId={editSubj} setEditId={setEditSubj} fieldKey="text" addLabel="件名追加" newVal="新しい件名" />
            </div>
          )}
          {estSubTab === "staff" && (
            <div><div style={S.sectionTitle}>作成者マスター（共通）</div>
              <SortableTable items={staff} setItems={setStaff} editId={editSt} setEditId={setEditSt} fieldKey="name" addLabel="担当者追加" newVal="新担当者" />
            </div>
          )}
        </div>
      )}

      {/* 報告書マスター */}
      {activeM === "rpt" && (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {[["clients","宛先"],["subjects","件名"],["referrals","ご紹介内容"],["staff","作成者"]].map(([k,l]) => (
              <button key={k} style={{ background: rptSubTab===k?"#2d5a3d":"transparent", color: rptSubTab===k?"#c8a96e":"#2d5a3d", border:"1px solid #2d5a3d44", borderRadius:4, padding:"6px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:"0.82rem", fontWeight:700, transition:"all .2s" }} onClick={() => setRptSubTab(k)}>{l}</button>
            ))}
          </div>
          {rptSubTab === "clients" && (
            <div><div style={S.sectionTitle}>宛先マスター（報告書用）</div>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"0.85rem" }}>
                <thead><tr><th style={S.th}>会社名</th><th style={{...S.th,width:140}}></th></tr></thead>
                <tbody>{reportClients.map((r) => (
                  <tr key={r.id}>{editRC===r.id ? (<><td style={S.td}><input style={S.input} value={r.name} onChange={(e)=>setReportClients(p=>p.map(x=>x.id===r.id?{...x,name:e.target.value}:x))}/></td><td style={S.td}><button style={S.btnSm()} onClick={()=>setEditRC(null)}>完了</button></td></>) : (<><td style={S.td}>{r.name}</td><td style={S.td}><button style={{...S.btnSm(),marginRight:6}} onClick={()=>setEditRC(r.id)}>編集</button><button style={S.btnSm("#c0392b")} onClick={()=>setReportClients(p=>p.filter(x=>x.id!==r.id))}>削除</button></td></>)}</tr>
                ))}</tbody>
              </table>
              <div style={{marginTop:10}}><button style={S.btn()} onClick={()=>setReportClients(p=>[...p,{id:Date.now(),name:"新しい宛先"}])}>＋ 宛先追加</button></div>
            </div>
          )}
          {rptSubTab === "subjects" && (
            <div><div style={S.sectionTitle}>件名マスター（報告書用）</div>
              <SortableTable items={reportSubjects} setItems={setReportSubjects} editId={editRS} setEditId={setEditRS} fieldKey="text" addLabel="件名追加" newVal="新しい件名" />
            </div>
          )}
          {rptSubTab === "referrals" && (
            <div><div style={S.sectionTitle}>ご紹介内容マスター（報告書用）</div>
              <SortableTable items={referralItems} setItems={setReferralItems} editId={editRef} setEditId={setEditRef} fieldKey="text" addLabel="ご紹介内容追加" newVal="新しいご紹介内容" />
            </div>
          )}
          {rptSubTab === "staff" && (
            <div><div style={S.sectionTitle}>作成者マスター（共通）</div>
              <SortableTable items={staff} setItems={setStaff} editId={editSt} setEditId={setEditSt} fieldKey="name" addLabel="担当者追加" newVal="新担当者" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  const [tab,              setTab]              = useState("invoice");
  const [companies,        setCompanies]        = useState(() => load(KEYS.companies,    initialCompanies));
  const [invoiceProducts,  setInvoiceProducts]  = useState(() => load(KEYS.invProducts,  initialInvoiceProducts));
  const [estimateProducts, setEstimateProducts] = useState(() => load(KEYS.estProducts,  initialEstimateProducts));
  const [staff,            setStaff]            = useState(() => load(KEYS.staff,        initialStaff));
  const [subjects,         setSubjects]         = useState(() => load(KEYS.subjects,     initialSubjects));
  const [referralItems,    setReferralItems]    = useState(() => load(KEYS.referrals,    initialReferralItems));
  const [reportClients,    setReportClients]    = useState(() => load(KEYS.rptClients,   initialReportClients));
  const [reportSubjects,   setReportSubjects]   = useState(() => load(KEYS.rptSubjects,  initialReportSubjects));
  const [docs,             setDocs]             = useState(() => load(KEYS.docs,         []));
  const [trash,            setTrash]            = useState(() => load(KEYS.trash,        []));
  const [viewDoc,          setViewDoc]          = useState(null);
  const [printHTML,        setPrintHTML]        = useState(null);
  const [saveMsg,          setSaveMsg]          = useState(false);
  const [importPreview,    setImportPreview]    = useState(null);
  const [importWizard,     setImportWizard]     = useState(null);  // 確認ウィザード
  const [masterSyncing,    setMasterSyncing]    = useState(false); // マスター同期中フラグ
  const [masterSyncMsg,    setMasterSyncMsg]    = useState(null);  // 同期結果メッセージ

  // Firebase 接続状態
  const [fbDb,     setFbDb]     = useState(null);
  const [fbStatus, setFbStatus] = useState("connecting"); // "connecting" | "online" | "offline"
  const unsubDocs  = useRef(null);
  const unsubTrash = useRef(null);

  // ── SheetJS ロード（GitHub/本番環境用。デモ画面では外部CDN無効のためスキップ） ──
  // useEffect(() => { ... }, []);  // GitHub版のindex.htmlでSheetJSを読み込むため不要

  // ── Firebase 初期化 ──
  useEffect(() => {
    loadFirebase().then(db => {
      setFbDb(db);
      setFbStatus("online");

      // マスターデータをFirestoreから取得（なければローカル初期値をアップロード）
      fbGetMasters(db).then(masters => {
        const setIfExists = (key, setter, fallback) => {
          if (masters[key] && masters[key].length > 0) setter(masters[key]);
          else fbSetMaster(db, key, fallback); // 初回：初期値をアップロード
        };
        setIfExists("companies",        setCompanies,        initialCompanies);
        setIfExists("invoiceProducts",  setInvoiceProducts,  initialInvoiceProducts);
        setIfExists("estimateProducts", setEstimateProducts, initialEstimateProducts);
        setIfExists("staff",            setStaff,            initialStaff);
        setIfExists("subjects",         setSubjects,         initialSubjects);
        setIfExists("referralItems",    setReferralItems,    initialReferralItems);
        setIfExists("reportClients",    setReportClients,    initialReportClients);
        setIfExists("reportSubjects",   setReportSubjects,   initialReportSubjects);
      });

      // docs・trash はリアルタイム購読
      unsubDocs.current  = fbSubscribe(db, COLLECTIONS.docs,  setDocs);
      unsubTrash.current = fbSubscribe(db, COLLECTIONS.trash, setTrash);
    }).catch(() => {
      setFbStatus("offline");
      console.warn("Firebase接続失敗。ローカルデータで動作します。");
    });
    return () => {
      unsubDocs.current?.();
      unsubTrash.current?.();
    };
  }, []);

  // ── マスターデータ変更時: Firestore + localStorage 両方に保存 ──
  // マスターはローカルのみ自動保存（Firebase保存は手動同期ボタンで行う）
  useEffect(() => { persist(KEYS.companies,   companies);        }, [companies]);
  useEffect(() => { persist(KEYS.invProducts,  invoiceProducts);  }, [invoiceProducts]);
  useEffect(() => { persist(KEYS.estProducts,  estimateProducts); }, [estimateProducts]);
  useEffect(() => { persist(KEYS.staff,        staff);            }, [staff]);
  useEffect(() => { persist(KEYS.subjects,     subjects);         }, [subjects]);
  useEffect(() => { persist(KEYS.referrals,    referralItems);    }, [referralItems]);
  useEffect(() => { persist(KEYS.rptClients,   reportClients);    }, [reportClients]);
  useEffect(() => { persist(KEYS.rptSubjects,  reportSubjects);   }, [reportSubjects]);

  const newBlankDoc = (type = "invoice") => {
    const isReport = type === "report_tax" || type === "report_notax";
    return {
      id: genId(), type,
      docNumber:      isReport ? "" : formatDocNumber(type, docs),
      reportNumber:   isReport ? formatDocNumber(type, docs) : "",
      createdAt:      today(),
      dueDate:        isReport ? "" : nextMonthEnd(),
      workDate:       "",
      clientName:     "",
      honorific:      "御中",  // 御中 or 様
      subject:        "",
      note:           "",
      specialNotes:   "",
      staff:          staff[0]?.name || "",
      companyId:      companies[0]?.id || 1,
      items:          isReport ? [] : BLANK_ITEMS(),
      reportItems:    isReport ? BLANK_REPORT_ROWS() : [],
      discount:       0,
      discountType:   "%",
      partialPayment: 0,
      editLog:        [],
    };
  };

  const [form, setForm] = useState(() => newBlankDoc());

  const handleNew  = (type) => { setForm(newBlankDoc(type)); setTab(type); };
  const isReportTab = (t) => t === "report_tax" || t === "report_notax";
  const handleEdit = (doc)  => {
    const isReport = doc.type === "report_tax" || doc.type === "report_notax";
    if (isReport) {
      const reportItems = [...(doc.reportItems || [])];
      while (reportItems.length < 10) reportItems.push(EMPTY_REPORT_ROW());
      setForm({ ...doc, reportItems: reportItems.slice(0, 10), editLog: doc.editLog || [] });
    } else {
      const items = [...(doc.items || [])];
      while (items.length < 10) items.push(EMPTY_ITEM());
      setForm({ ...doc, items: items.slice(0, 10), partialPayment: doc.partialPayment || 0, editLog: doc.editLog || [] });
    }
    setTab(doc.type);
  };

  const setField      = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setItem       = (idx, patch) => setForm((f) => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, ...patch } : it) }));
  const clearItem     = (idx) => setItem(idx, { name: "", qty: 1, price: 0 });
  const setReportRow  = (idx, patch) => setForm((f) => ({ ...f, reportItems: (f.reportItems||[]).map((r, i) => i === idx ? { ...r, ...patch } : r) }));
  const clearReportRow = (idx) => setReportRow(idx, EMPTY_REPORT_ROW());

  // ============================================================
  // BACKUP / RESTORE
  // ============================================================
  const handleBackup = () => {
    const data = {
      version:          1,
      exportedAt:       new Date().toISOString(),
      docs,
      companies,
      invoiceProducts,
      estimateProducts,
      staff,
      subjects,
      referralItems,
      reportClients,
      reportSubjects,
      trash,
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    const ts   = new Date().toISOString().slice(0, 10);
    a.href     = url;
    a.download = `invoice-backup-${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRestore = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm("現在のデータをすべてバックアップファイルの内容で上書きします。\nよろしいですか？")) {
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.version !== 1) throw new Error("バージョン不一致");
        if (data.docs)             setDocs(data.docs);
        if (data.companies)        setCompanies(data.companies);
        if (data.invoiceProducts)  setInvoiceProducts(data.invoiceProducts);
        if (data.estimateProducts) setEstimateProducts(data.estimateProducts);
        if (data.staff)            setStaff(data.staff);
        if (data.subjects)         setSubjects(data.subjects);
        if (data.referralItems)    setReferralItems(data.referralItems);
        if (data.reportClients)    setReportClients(data.reportClients);
        if (data.reportSubjects)   setReportSubjects(data.reportSubjects);
        if (data.trash)            setTrash(data.trash);
        alert(`✅ リストア完了\n書類: ${(data.docs||[]).length}件\nエクスポート日時: ${data.exportedAt?.slice(0,16).replace("T"," ")}`);
      } catch (err) {
        alert("❌ リストアに失敗しました。\n正しいバックアップファイルか確認してください。\n" + err.message);
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  };

  const saveDoc = () => {
    const existing = docs.find((d) => d.id === form.id);
    let newDoc;
    if (existing) {
      const changes = detectChanges(existing, form);
      const logEntry = changes.length > 0
        ? { at: nowStr(), changes }
        : { at: nowStr(), changes: ["変更なし（再保存）"] };
      newDoc = { ...form, editLog: [logEntry, ...(form.editLog || [])] };
    } else {
      newDoc = { ...form, editLog: [{ at: nowStr(), changes: ["新規作成"] }] };
    }
    // ローカル更新
    setDocs((prev) => existing ? prev.map((d) => d.id === newDoc.id ? newDoc : d) : [...prev, newDoc]);
    setForm(newDoc);
    // Firebase に保存（接続中のみ）
    if (fbDb) fbSaveDoc(fbDb, COLLECTIONS.docs, newDoc).catch(console.error);
    else persist(KEYS.docs, existing ? docs.map((d) => d.id === newDoc.id ? newDoc : d) : [...docs, newDoc]);
    setSaveMsg(true);
    setTimeout(() => setSaveMsg(false), 2500);
  };

  const printPDF = (doc) => {
    const co  = companies.find((c) => c.id === doc.companyId) || companies[0] || {};
    const isReport = doc.type === "report_tax" || doc.type === "report_notax";
    const html = isReport ? buildReportPrintHTML(doc, co) : buildPrintHTML(doc, co);
    setPrintHTML(html);
  };

  // ============================================================
  // EXCEL インポート（弊社XLSフォーマット対応）
  // ============================================================
  const handleImportExcel = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      const processFile = () => {
        try {
          const XLSXLib = window.XLSX;
          if (!XLSXLib) { alert("SheetJSが読み込まれていません。ページを再読み込みしてください。"); return; }
          const data = new Uint8Array(ev.target.result);
          const wb   = XLSXLib.read(data, { type: "array" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSXLib.utils.sheet_to_json(ws, { header: 1, defval: "" });

        let clientName       = "";
        let staffName        = "";
        let venueName        = "";
        let workDate         = "";
        let partialPaymentAmt = 0;
        const items          = [];

        rows.forEach((row, i) => {
          if (i === 0) return;
          const col7 = String(row[7] || "").trim();
          const col6 = String(row[6] || "").trim();
          const col5 = String(row[5] || "").trim();

          // 宛先行：col6に数字とハイフンが含まれる（電話番号・顧客番号など）かつ col7に氏名
          // 様々な桁数の電話番号や顧客コードに対応するため正規表現を緩く設定
          if (col6 && /[\d\-]{8,}/.test(col6) && col7 && !col7.includes("※") && !col7.includes("計")) {
            clientName = col7.replace(/\s+/g, " ").trim();
            return;
          }
          // 明細行（種 = 売上 かつ 商品名あり かつ 集計行でない）
          if (col5 === "売上" && col7 && !col7.includes("※") && !col7.includes("計")) {
            const yr  = Number(row[0]);
            const mo  = Number(row[1]);
            const dy  = Number(row[2]);
            const qtyRaw = Math.abs(Number(row[11])) || 1;
            // 金額はマイナスもそのまま取り込む（返品・修正対応）
            const amt = row[13] !== "" && row[13] !== null ? Number(row[13]) : 0;
            // 返品・修正行（金額マイナス）は数量もマイナス扱いにして相殺
            // 例: +30000(1個) / -30000(-1個) / +40000(1個) → 数量1個・金額40000
            const qty = amt < 0 ? -qtyRaw : qtyRaw;
            if (!staffName && row[12]) staffName = String(row[12]).trim();
            if (!venueName && row[14]) venueName = String(row[14]).trim();
            if (!workDate && yr > 2000) {
              workDate = yr + "-" + String(mo).padStart(2,"0") + "-" + String(dy).padStart(2,"0");
            }
            const itemName = col7.trim();
            // 同名商品は合算（例: 新婦衣裳30 + -30 + 40 → 新婦衣裳40）
            // 数量・合計金額（amount）の両方を加算し、単価は amount から表示時に算出
            const existing = items.find(it => it.name === itemName);
            if (existing) {
              existing.qty    += qty;   // 数量を合算
              existing.amount += amt;   // 合計金額を合算
            } else {
              items.push({ name: itemName, qty, amount: amt, price: qty ? Math.round(amt / qty) : amt });
            }
          }

          // 入金行（種が空欄 かつ 入金列(col17)に数値あり）
          // プラス入金・マイナス入金（返金・取消）を正確に合算する
          if (!col5 && row[17] !== "" && row[17] !== null && !isNaN(Number(row[17])) && Number(row[17]) !== 0) {
            partialPaymentAmt += Number(row[17]);  // マイナスはそのままマイナスで加算（差し引き）
          }
        });

        // 合算後に合計金額が0のものを除外（完全相殺された明細）
        const mergedItems = items
          .filter(it => Number(it.amount) !== 0)
          .map(it => ({
            ...it,
            // 合算後の数量で単価を再計算（割り切れない端数は単価を丸め・表示は amount を優先）
            price: it.qty ? Math.round(it.amount / it.qty) : it.amount,
          }));
        while (mergedItems.length < 10) mergedItems.push(EMPTY_ITEM());
        setImportPreview({
          clientName,
          staff:          form.staff,  // 作成者はExcelから反映しない・現在選択中の値を維持
          workDate,
          subject:        venueName ? venueName + " 様関連のご請求" : "",
          note:           "上記の通り、ご請求申し上げます。",
          items:          mergedItems.slice(0, 10),
          venueName,
          partialPayment: partialPaymentAmt,
        });
        } catch (err) {
          alert("読み込みに失敗しました。\nファイル形式を確認してください。\n" + err.message);
        }
      };

      // SheetJS がまだロードされていなければ動的に読み込んでから実行
      if (window.XLSX) {
        processFile();
      } else {
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
        s.onload = processFile;
        s.onerror = () => alert("SheetJS の読み込みに失敗しました。インターネット接続を確認してください。");
        document.head.appendChild(s);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const applyImport = () => {
    if (!importPreview) return;
    setForm((f) => ({
      ...f,
      type:           "invoice",
      docNumber:      formatDocNumber("invoice", docs),
      clientName:     importPreview.clientName,
      honorific:      f.honorific || "御中",
      staff:          importPreview.staff,
      workDate:       importPreview.workDate,
      subject:        importPreview.subject,
      note:           importPreview.note,
      items:          importPreview.items,
      partialPayment: importPreview.partialPayment || 0,
    }));
    setImportPreview(null);
    setTab("invoice");
    // 確認ウィザードを少し遅らせて起動（フォーム反映後）
    setTimeout(() => setImportWizard({ step: 0 }), 150);
  };

  // ── マスター手動同期関数 ──
  const pushMastersToFirebase = async () => {
    if (!fbDb) { setMasterSyncMsg({ type: "error", text: "Firebaseに接続されていません。オフライン状態です。" }); return; }
    setMasterSyncing(true);
    try {
      await Promise.all([
        fbSetMaster(fbDb, "companies",        companies),
        fbSetMaster(fbDb, "invoiceProducts",  invoiceProducts),
        fbSetMaster(fbDb, "estimateProducts", estimateProducts),
        fbSetMaster(fbDb, "staff",            staff),
        fbSetMaster(fbDb, "subjects",         subjects),
        fbSetMaster(fbDb, "referralItems",    referralItems),
        fbSetMaster(fbDb, "reportClients",    reportClients),
        fbSetMaster(fbDb, "reportSubjects",   reportSubjects),
      ]);
      setMasterSyncMsg({ type: "success", text: "✅ マスター情報を全端末に反映しました" });
    } catch (e) {
      setMasterSyncMsg({ type: "error", text: "❌ 反映に失敗しました: " + e.message });
    }
    setMasterSyncing(false);
    setTimeout(() => setMasterSyncMsg(null), 3500);
  };

  const pullMastersFromFirebase = async () => {
    if (!fbDb) { setMasterSyncMsg({ type: "error", text: "Firebaseに接続されていません。" }); return; }
    setMasterSyncing(true);
    try {
      const masters = await fbGetMasters(fbDb);
      if (masters.companies)        setCompanies(masters.companies);
      if (masters.invoiceProducts)  setInvoiceProducts(masters.invoiceProducts);
      if (masters.estimateProducts) setEstimateProducts(masters.estimateProducts);
      if (masters.staff)            setStaff(masters.staff);
      if (masters.subjects)         setSubjects(masters.subjects);
      if (masters.referralItems)    setReferralItems(masters.referralItems);
      if (masters.reportClients)    setReportClients(masters.reportClients);
      if (masters.reportSubjects)   setReportSubjects(masters.reportSubjects);
      setMasterSyncMsg({ type: "success", text: "✅ 最新のマスター情報を取得しました" });
    } catch (e) {
      setMasterSyncMsg({ type: "error", text: "❌ 取得に失敗しました: " + e.message });
    }
    setMasterSyncing(false);
    setTimeout(() => setMasterSyncMsg(null), 3500);
  };

  const moveToTrash = (id) => {
    if (!confirm("ゴミ箱に移動しますか？\nゴミ箱から元に戻すことができます。")) return;
    const doc = docs.find((d) => d.id === id);
    if (!doc) return;
    const trashed = { ...doc, trashedAt: nowStr() };
    setDocs((prev) => prev.filter((d) => d.id !== id));
    setTrash((prev) => [trashed, ...prev]);
    if (fbDb) {
      fbDeleteDoc(fbDb, COLLECTIONS.docs, id).catch(console.error);
      fbSaveDoc(fbDb, COLLECTIONS.trash, trashed).catch(console.error);
    }
  };

  const restoreFromTrash = (id) => {
    const doc = trash.find((d) => d.id === id);
    if (!doc) return;
    const { trashedAt, ...restored } = doc;
    setTrash((prev) => prev.filter((d) => d.id !== id));
    setDocs((prev) => [restored, ...prev]);
    if (fbDb) {
      fbDeleteDoc(fbDb, COLLECTIONS.trash, id).catch(console.error);
      fbSaveDoc(fbDb, COLLECTIONS.docs, restored).catch(console.error);
    }
  };

  return (
    <div style={S.app}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;700&display=swap" rel="stylesheet" />
      <header style={{ ...S.header, height: "auto", flexDirection: "column", alignItems: "stretch", padding: "0 1.5rem" }}>
        {/* 1行目：タイトル ＋ 同期バッジ */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 48, borderBottom: "1px solid #c8a96e22" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* アプリ名 + バージョン */}
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
              <span style={{ fontSize: "1.4rem", fontWeight: 900, letterSpacing: "0.18em", color: "#c8a96e", fontFamily: "Georgia, serif" }}>IER</span>
              <span style={{ fontSize: "0.62rem", color: "#c8a96e88", letterSpacing: "0.1em", marginTop: 1 }}>Ver1-012</span>
            </div>
            <span style={{ width: 1, height: 28, background: "#c8a96e33" }} />
            <span style={{ fontSize: "0.78rem", color: "#e8d9c0aa", letterSpacing: "0.05em" }}>Invoice · Estimate · Report</span>
            <span style={{
              fontSize: "0.68rem", fontWeight: 700, padding: "2px 8px", borderRadius: 10,
              background: fbStatus === "online" ? "#2ecc71" : fbStatus === "connecting" ? "#f39c12" : "#e74c3c",
              color: "#fff", letterSpacing: "0.04em", whiteSpace: "nowrap",
            }}>
              {fbStatus === "online" ? "🟢 同期中" : fbStatus === "connecting" ? "🟡 接続中..." : "🔴 オフライン"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: "0.7rem", color: "#c8a96e88" }}>データ管理:</span>
            <button title="全データをJSONファイルに保存" onClick={handleBackup}
              style={{ background: "#2d6a9e", color: "#fff", border: "none", borderRadius: 4, padding: "4px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: "0.75rem", fontWeight: 700 }}>
              💾 バックアップ
            </button>
            <label title="バックアップJSONを読み込んで全データを復元"
              style={{ background: "#7a5c2e", color: "#fff", border: "none", borderRadius: 4, padding: "4px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: "0.75rem", fontWeight: 700 }}>
              📂 リストア
              <input type="file" accept=".json" style={{ display: "none" }} onChange={handleRestore} />
            </label>
          </div>
        </div>
        {/* 2行目：ナビゲーション */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, height: 44 }}>
          <button style={S.navBtn(tab === "invoice")}     onClick={() => handleNew("invoice")}>＋ 請求書</button>
          <button style={S.navBtn(tab === "estimate")}    onClick={() => handleNew("estimate")}>＋ 見積書</button>
          <button style={{ ...S.navBtn(tab === "report_tax"),   background: tab === "report_tax"   ? "#2d5a3d" : "transparent", color: tab === "report_tax"   ? "#c8a96e" : "#e8d9c0", borderColor: "#2d5a3d66" }} onClick={() => handleNew("report_tax")}>＋ 報告書（税有）</button>
          <button style={{ ...S.navBtn(tab === "report_notax"), background: tab === "report_notax" ? "#4a3d7a" : "transparent", color: tab === "report_notax" ? "#c8a96e" : "#e8d9c0", borderColor: "#4a3d7a66" }} onClick={() => handleNew("report_notax")}>＋ 報告書（税無）</button>
          <span style={{ width: 1, height: 20, background: "#c8a96e33", margin: "0 2px" }} />
          <button style={S.navBtn(tab === "history")}  onClick={() => setTab("history")}>履歴</button>
          <button style={S.navBtn(tab === "master")}   onClick={() => setTab("master")}>マスター管理</button>
          <button style={{ ...S.navBtn(tab === "trash"), color: tab === "trash" ? "#1a1208" : "#e8a0a0", borderColor: "#e8a0a066" }}
            onClick={() => setTab("trash")}>
            🗑 ゴミ箱{trash.length > 0 ? ` (${trash.length})` : ""}
          </button>
        </div>
      </header>
      <main style={S.main}>
        {(tab === "invoice" || tab === "estimate" || tab === "report_tax" || tab === "report_notax") && (
          <EditPanel form={form} setField={setField} setForm={setForm} setItem={setItem} clearItem={clearItem}
            companies={companies} staff={staff} subjects={subjects}
            invoiceProducts={invoiceProducts} estimateProducts={estimateProducts}
            docs={docs} saveDoc={saveDoc} printPDF={printPDF}
            setReportRow={setReportRow} clearReportRow={clearReportRow}
            referralItems={referralItems} reportClients={reportClients} reportSubjects={reportSubjects}
            onImportExcel={handleImportExcel} />
        )}

        {tab === "history" && (
          <HistoryPanel docs={docs} calcTotals={calcTotals}
            onView={setViewDoc} onEdit={handleEdit} onTrash={moveToTrash} />
        )}
        {tab === "trash" && (
          <TrashPanel trash={trash} calcTotals={calcTotals} onRestore={restoreFromTrash} />
        )}
        {tab === "master" && (
          <MasterPanel
            companies={companies} setCompanies={setCompanies}
            invoiceProducts={invoiceProducts} setInvoiceProducts={setInvoiceProducts}
            estimateProducts={estimateProducts} setEstimateProducts={setEstimateProducts}
            staff={staff} setStaff={setStaff}
            subjects={subjects} setSubjects={setSubjects}
            referralItems={referralItems} setReferralItems={setReferralItems}
            reportClients={reportClients} setReportClients={setReportClients}
            reportSubjects={reportSubjects} setReportSubjects={setReportSubjects}
            onPush={pushMastersToFirebase}
            onPull={pullMastersFromFirebase}
            syncing={masterSyncing}
            fbStatus={fbStatus} />
        )}
      </main>
      {viewDoc && (
        <DetailModal doc={viewDoc}
          company={companies.find((c) => c.id === viewDoc.companyId) || companies[0] || {}}
          onClose={() => setViewDoc(null)}
          onEdit={() => { handleEdit(viewDoc); setViewDoc(null); }}
          onPrint={() => printPDF(viewDoc)} />
      )}

      {/* PDF プレビューモーダル */}
      {printHTML && (
        <div style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 2000, display: "flex", flexDirection: "column" }}>
          {/* ツールバー */}
          <div style={{ background: "#1a1208", color: "#e8d9c0", padding: "10px 20px", display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
            <span style={{ fontWeight: 700, fontSize: "0.95rem", letterSpacing: "0.08em" }}>🖨 PDF プレビュー</span>
            <span style={{ fontSize: "0.8rem", color: "#c8a96e88" }}>印刷ダイアログから「PDFとして保存」を選択してください</span>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => {
                const iframe = document.getElementById("pdf-iframe");
                if (iframe) { iframe.contentWindow.focus(); iframe.contentWindow.print(); }
              }}
              style={{ background: "#c8a96e", color: "#1a1208", border: "none", borderRadius: 4, padding: "7px 20px", cursor: "pointer", fontWeight: 700, fontSize: "0.9rem", fontFamily: "inherit" }}>
              🖨 印刷 / PDFで保存
            </button>
            <button
              onClick={() => setPrintHTML(null)}
              style={{ background: "transparent", color: "#e8d9c0", border: "1px solid #c8a96e44", borderRadius: 4, padding: "7px 16px", cursor: "pointer", fontWeight: 700, fontSize: "0.9rem", fontFamily: "inherit" }}>
              ✕ 閉じる
            </button>
          </div>
          {/* iframe */}
          <iframe
            id="pdf-iframe"
            srcDoc={printHTML}
            style={{ flex: 1, border: "none", background: "#888" }}
            title="PDF プレビュー"
          />
        </div>
      )}

      {/* ━━ Excelインポート確認ウィザード ━━ */}
      {importWizard && (
        <ImportWizard
          step={importWizard.step}
          form={form}
          setField={setField}
          subjects={subjects}
          onNext={(nextStep) => {
            if (nextStep === null) setImportWizard(null);
            else setImportWizard({ step: nextStep });
          }}
        />
      )}

      {/* Excel インポート確認モーダル */}
      {importPreview && (
        <div style={{ position: "fixed", inset: 0, background: "#0008", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          onClick={(e) => { if (e.target === e.currentTarget) setImportPreview(null); }}>
          <div style={{ background: "#fff", borderRadius: 10, width: "100%", maxWidth: 680, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 8px 48px #0005", fontFamily: "inherit" }}>
            {/* モーダルヘッダー */}
            <div style={{ background: "#2d6a9e", color: "#fff", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", borderRadius: "10px 10px 0 0" }}>
              <span style={{ fontSize: "1rem", fontWeight: 700 }}>📂 Excelデータ読み込み確認</span>
              <button style={{ background: "transparent", color: "#fff", border: "none", cursor: "pointer", fontSize: "1.2rem" }} onClick={() => setImportPreview(null)}>✕</button>
            </div>
            <div style={{ padding: 24 }}>
              <p style={{ fontSize: "0.85rem", color: "#666", marginBottom: 16 }}>
                以下の内容で請求書に自動入力します。確認後「この内容で入力する」を押してください。
              </p>
              {/* 基本情報 */}
              <div style={{ background: "#f5f0eb", borderRadius: 6, padding: "12px 16px", marginBottom: 16, fontSize: "0.85rem" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[["宛先", importPreview.clientName || "（未取得）"],["担当者", importPreview.staff],["施行日", importPreview.workDate || "（未取得）"],["式場", importPreview.venueName || "（未取得）"],["件名", importPreview.subject],["内入金済み", importPreview.partialPayment > 0 ? "¥ " + fmt(importPreview.partialPayment) : "なし"]].map(([l,v]) => (
                    <div key={l} style={{ display: "flex", gap: 8 }}>
                      <span style={{ color: "#7a5c2e", fontWeight: 700, minWidth: 60 }}>{l}</span>
                      <span>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* 明細プレビュー */}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", marginBottom: 16 }}>
                <thead><tr>
                  <th style={{ background: "#1a1208", color: "#c8a96e", padding: "6px 10px", textAlign: "left" }}>品目</th>
                  <th style={{ background: "#1a1208", color: "#c8a96e", padding: "6px 10px", textAlign: "center", width: 60 }}>数量</th>
                  <th style={{ background: "#1a1208", color: "#c8a96e", padding: "6px 10px", textAlign: "right", width: 110 }}>単価</th>
                  <th style={{ background: "#1a1208", color: "#c8a96e", padding: "6px 10px", textAlign: "right", width: 110 }}>金額</th>
                </tr></thead>
                <tbody>
                  {importPreview.items.filter(i => i.name).map((item, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "#fffdf9" : "#f7f3ee" }}>
                      <td style={{ padding: "5px 10px", borderBottom: "1px solid #e0d8cc" }}>{item.name}</td>
                      <td style={{ padding: "5px 10px", borderBottom: "1px solid #e0d8cc", textAlign: "center" }}>{item.qty}</td>
                      <td style={{ padding: "5px 10px", borderBottom: "1px solid #e0d8cc", textAlign: "right" }}>¥ {fmt(item.price)}</td>
                      <td style={{ padding: "5px 10px", borderBottom: "1px solid #e0d8cc", textAlign: "right", fontWeight: 600 }}>¥ {fmt(itemGross(item))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button style={{ background: "#888", color: "#fff", border: "none", borderRadius: 4, padding: "9px 20px", cursor: "pointer", fontFamily: "inherit", fontSize: "0.88rem", fontWeight: 700 }} onClick={() => setImportPreview(null)}>キャンセル</button>
                <button style={{ background: "#2d6a9e", color: "#fff", border: "none", borderRadius: 4, padding: "9px 24px", cursor: "pointer", fontFamily: "inherit", fontSize: "0.88rem", fontWeight: 700 }} onClick={applyImport}>✅ この内容で入力する</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* マスター同期結果トースト */}
      {masterSyncMsg && (
        <div style={{
          position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)",
          background: masterSyncMsg.type === "success" ? "#2d5a3d" : "#c0392b",
          color: "#fff", borderRadius: 8, padding: "14px 32px",
          fontWeight: 700, fontSize: "0.95rem",
          boxShadow: "0 4px 20px #0004", zIndex: 3000, whiteSpace: "nowrap",
        }}>
          {masterSyncMsg.text}
        </div>
      )}

      {/* 保存完了 トースト */}
      {saveMsg && (
        <div style={{
          position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)",
          background: "#2ecc71", color: "#fff", borderRadius: 8,
          padding: "14px 32px", fontWeight: 700, fontSize: "1rem",
          boxShadow: "0 4px 20px #0004", zIndex: 3000,
          display: "flex", alignItems: "center", gap: 10,
          animation: "fadein 0.2s ease",
        }}>
          ✅ 保存が完了しました
        </div>
      )}
    </div>
  );
}
