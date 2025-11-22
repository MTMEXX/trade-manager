// === PORTFOLIO ANALYZER — Versione adattata al CSV personale MEX ===
// CSV richiesto:
//
// DESCRIZIONE,MOVIMENTO,QTA,IMPORTO,DATA,TIPOLOGIA
//
// Esempi MOVIMENTO:
// - Entrata  (vendite, dividendi)
// - Uscita   (acquisti, competenze, imposte)
//
// IMPORTO è totale OVERALL (commissioni già incluse)

// === UTILS ===
function parseNum(v) {
  if (!v) return 0;
  return parseFloat(
    v.toString()
      .replace("€", "")
      .replace(/\./g, "")
      .replace(",", ".")
      .trim()
  );
}

// === BUTTON HANDLER ===
document.getElementById("analyzeBtn").addEventListener("click", () => {
  const file = document.getElementById("csvFile").files[0];
  if (!file) return alert("Carica un CSV prima.");

  const reader = new FileReader();
  reader.onload = e => parseCSV(e.target.result);
  reader.readAsText(file);
});

// === CSV PARSER ===
function parseCSV(text) {
  const delimiter = text.split("\n")[0].includes(";") ? ";" : ",";

  const rows = text.trim().split("\n").map(r => r.split(delimiter));
  const headers = rows[0].map(h => h.trim().toUpperCase());

  const trades = rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = (r[i] || "").trim());
    return obj;
  });

  analyzeTrades(trades);
}

// === CORE LOGIC ===
function analyzeTrades(trades) {
  let closedPnL = 0;
  let totalFees = 0;
  let wins = 0, losses = 0;

  const positions = {}; // DESCRIZIONE → { qty, avg }

  trades.forEach(t => {
    const asset = t["DESCRIZIONE"];
    const movimento = t["MOVIMENTO"]; // Entrata / Uscita
    const tipo = t["TIPOLOGIA"];      // Acquisto titoli / Vendita titoli / Dividendi / Imposte…
    const qty = parseNum(t["QTA"]);
    const amount = parseNum(t["IMPORTO"]); // TOTAL import (negativo o positivo)

    // --- SPESE / IMPOSTE ---
    if (tipo === "Competenze" || tipo === "Imposta") {
      closedPnL += amount; // amount è negativo, abbassa il PnL
      return;
    }

    // --- DIVIDENDI ---
    if (tipo === "Accredito dividendi") {
      closedPnL += amount; // positivo → profit
      return;
    }

    // --- ASSICURA asset esistente ---
    if (!positions[asset]) positions[asset] = { qty: 0, avg: 0 };
    const pos = positions[asset];

    // --- ACQUISTO ---
    if (movimento === "Uscita" && tipo === "Acquisto titoli") {
      const totalCost = Math.abs(amount);
      const oldValue = pos.qty * pos.avg;
      const newValue = oldValue + totalCost;
      pos.qty += qty;
      pos.avg = newValue / pos.qty;
    }

    // --- VENDITA ---
    if (movimento === "Entrata" && tipo === "Vendita titoli") {
      if (pos.qty <= 0) return;

      const sellValue = amount; // positivo
      const costBasis = pos.avg * qty;
      const realized = sellValue - costBasis;

      closedPnL += realized;

      if (realized >= 0) wins++;
      else losses++;

      pos.qty -= qty;
      if (pos.qty <= 0) pos.avg = 0;
    }
  });

  const openPositions = Object.entries(positions)
    .filter(([_, p]) => p.qty > 0)
    .map(([asset, p]) => ({
      asset,
      qty: p.qty,
      avg: p.avg
    }));

  const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;

  renderResults({
    closedPnL,
    wins,
    losses,
    winRate,
    openPositions
  });
}

// === RENDER UI ===
function renderResults(data) {
  const wrap = document.getElementById("results");
  wrap.classList.add("visible");

  const fmt = v => isFinite(v) ? v.toFixed(2) : "-";

  let html = `
    <h2>📊 Risultati Analisi</h2>
    <p><b>PNL Totale:</b> ${fmt(data.closedPnL)}</p>
    <p><b>Win rate:</b> ${data.wins}/${data.wins + data.losses} (${fmt(data.winRate)}%)</p>

    <h3>📂 Posizioni Aperte</h3>
  `;

  if (data.openPositions.length === 0) {
    html += `<p>Nessuna posizione aperta.</p>`;
  } else {
    html += `<table><tr><th>Asset</th><th>QTA</th><th>PM</th></tr>`;
    data.openPositions.forEach(p => {
      html += `<tr>
        <td>${p.asset}</td>
        <td>${p.qty}</td>
        <td>${fmt(p.avg)}</td>
      </tr>`;
    });
    html += `</table>`;
  }

  wrap.innerHTML = html;
}
