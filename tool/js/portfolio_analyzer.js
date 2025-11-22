/* === UTILS === */

// converte numeri europei tipo "-824,32 €"
function parseEuro(value) {
  if (!value) return 0;
  return parseFloat(
    value
      .toString()
      .replace(/[€\s]/g, "")
      .replace(".", "")
      .replace(",", ".")
  );
}

function normalize(str) {
  return str.toString().trim().toLowerCase();
}

/* === CARICAMENTO FILE === */

document.getElementById("analyzeBtn").addEventListener("click", () => {
  const file = document.getElementById("csvFile").files[0];
  if (!file) return alert("Carica un file CSV!");
  const reader = new FileReader();
  reader.onload = e => parseCSV(e.target.result);
  reader.readAsText(file, "latin1"); // Excel ITA
});

/* === PARSER CSV === */

function parseCSV(text) {
  const firstLine = text.split("\n")[0];
  const delimiter = firstLine.includes(";") ? ";" : ",";
  const rows = text.trim().split("\n").map(r => r.split(delimiter));

  const headers = rows[0].map(h => normalize(h));
  const data = rows.slice(1).map(row => {
    const o = {};
    headers.forEach((h, i) => o[h] = row[i] ? row[i].trim() : "");
    return o;
  });

  analyze(data);
}

/* === ANALISI DEL PORTAFOGLIO === */

function analyze(rows) {

  let closedPnL = 0;
  let commissions = 0;
  let wins = 0, losses = 0;
  const positions = {}; // asset → { qty, avg }

  rows.forEach(t => {
    const asset = t["descrizione"];
    const tipo = normalize(t["tipologia"]);
    const qty = parseFloat(t["qta'"]);
    const amount = parseEuro(t["importo"]);

    if (!asset || !qty || !tipo) return;

    /* ---------------------  
         CLASSIFICAZIONE  
       --------------------- */

    let side = null;

    if (tipo.includes("acquisto titoli")) side = "BUY";
    else if (tipo.includes("vendita titoli")) side = "SELL";
    else if (tipo.includes("dividendi")) side = "DIV";
    else if (tipo.includes("imposta")) side = "TAX";
    else if (tipo.includes("competenze") || tipo.includes("spese")) side = "FEE";
    else side = "OTHER";

    /* ---------------------
         LOGICA DI PORTAFOGLIO
       --------------------- */

    // ENTRATE/USCITE non legate a titoli
    if (side === "DIV") {
      closedPnL += amount;
      return;
    }
    if (side === "TAX" || side === "FEE") {
      closedPnL += amount; // negative importo → perdita
      commissions += Math.abs(amount);
      return;
    }

    // Ignora operazioni senza asset reale
    if (asset.toLowerCase().includes("spese") || asset.toLowerCase().includes("conto"))
      return;

    if (!positions[asset]) positions[asset] = { qty: 0, avg: 0 };

    const pos = positions[asset];

    if (side === "BUY") {
      const totalOld = pos.qty * pos.avg;
      const totalNew = totalOld + Math.abs(amount);
      pos.qty += qty;
      pos.avg = totalNew / pos.qty;
    }

    else if (side === "SELL") {
      const sellQty = Math.min(qty, pos.qty);
      const sellPrice = Math.abs(amount) / sellQty;

      const realized = (sellPrice - pos.avg) * sellQty;
      closedPnL += realized;

      if (realized >= 0) wins++; else losses++;

      pos.qty -= sellQty;
      if (pos.qty === 0) pos.avg = 0;
    }
  });

  /* --- POSIZIONI APERTE --- */
  const openPositions = Object.entries(positions)
    .filter(([_, p]) => p.qty > 0)
    .map(([asset, p]) => ({
      asset,
      quantity: p.qty,
      avg: p.avg
    }));

  render({
    closedPnL,
    wins,
    losses,
    commissions,
    openPositions
  });
}

/* === RENDER OUTPUT === */

function render(res) {
  const card = document.getElementById("results");
  card.classList.add("visible");

  const fmt = v => isFinite(v) ? v.toFixed(2) : "-";

  let html = `
    <h2>📊 Risultati Analisi</h2>
    <p><b>PNL totale:</b> ${fmt(res.closedPnL)} €</p>
    <p><b>Win rate:</b> ${res.wins}/${res.wins + res.losses}
       (${res.wins + res.losses > 0 ? (res.wins/(res.wins+res.losses)*100).toFixed(1) : "0"}%)</p>
    <p><b>Commissioni/spese totali:</b> ${fmt(res.commissions)} €</p>

    <h3>📂 Posizioni Aperte</h3>
  `;

  if (res.openPositions.length === 0) {
    html += `<p>Nessuna posizione aperta.</p>`;
  } else {
    html += `<table>
      <tr><th>Asset</th><th>Quantità</th><th>Prezzo Medio</th></tr>`;

    res.openPositions.forEach(p => {
      html += `<tr>
        <td>${p.asset}</td>
        <td>${p.quantity}</td>
        <td>${fmt(p.avg)}</td>
      </tr>`;
    });

    html += `</table>`;
  }

  card.innerHTML = html;
}
