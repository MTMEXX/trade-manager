function parseLocaleNumber(v){return parseFloat(v.toString().replace(',','.'));}

function updateRiskSuggestion(){
  const ing = parseLocaleNumber(document.getElementById("prezzoIngresso").value);
  const st = parseLocaleNumber(document.getElementById("prezzoStop").value);
  const box = document.getElementById("riskSuggestion");
  if(!isFinite(ing)||!isFinite(st)||st>=ing){ box.textContent=""; return;}
  const pct=((ing-st)/ing)*100;
  if(pct<1) box.textContent="Stop molto stretto: rischio consigliato 1%–1.5%.";
  else if(pct<3) box.textContent="Stop normale: rischio consigliato 0.5%–1%.";
  else box.textContent="Stop ampio: rischio consigliato 0.25%–0.5%.";
}
document.getElementById("prezzoIngresso").addEventListener("input", updateRiskSuggestion);
document.getElementById("prezzoStop").addEventListener("input", updateRiskSuggestion);

function renderMap(targets, ingresso, stop){
  const map=document.getElementById("tradeMap");
  map.innerHTML="";
  const min=stop;
  const max=ingresso + targets[targets.length-1].R * (ingresso - stop);
  targets.forEach(t=>{
    const x=((t.price-min)/(max-min))*100;
    const m=document.createElement("div");
    m.style.position="absolute";
    m.style.left=x+"%";
    m.style.width="2px";
    m.style.height="6px";
    m.style.background="#22c55e";
    map.appendChild(m);
  });
}

document.getElementById("calcolaBtn").addEventListener("click", ()=>{
  const cap=parseLocaleNumber(document.getElementById("capitale").value);
  const rischioPerc=parseLocaleNumber(document.getElementById("rischioPerc").value);
  const ingresso=parseLocaleNumber(document.getElementById("prezzoIngresso").value);
  const stop=parseLocaleNumber(document.getElementById("prezzoStop").value);
  const commissione=parseLocaleNumber(document.getElementById("commissione").value);
  const fx=parseLocaleNumber(document.getElementById("fxRate").value||"1");
  const capCur=document.getElementById("capitalCurrency").value;
  const tradeCur=document.getElementById("tradeCurrency").value;
  const prof=document.getElementById("profiloGestione").value;

  const stopDist=ingresso-stop;
  let rischioCap=cap*(rischioPerc/100);
  let rischioTrade=(capCur===tradeCur)? rischioCap : rischioCap*fx;
  let q=Math.floor((rischioTrade-2*commissione)/stopDist);
  if(q<1){ document.getElementById("output").innerHTML="Quantità troppo bassa."; return;}

  const profili={
    conservativo:[{R:0.8,perc:40},{R:1.5,perc:30},{R:2.5,perc:20}],
    standard:[{R:1,perc:30},{R:2,perc:30},{R:3,perc:20}],
    aggressivo:[{R:1.5,perc:20},{R:3,perc:30},{R:4.5,perc:20}],
    trend:[{R:2,perc:15},{R:3,perc:20},{R:5,perc:15}]
  };
  const lv=profili[prof];
  const targets=lv.map(l=>({R:l.R, price:ingresso+l.R*stopDist}));
  renderMap(targets, ingresso, stop);

  document.getElementById("output").innerHTML =
    "Quantità: "+q+"<br>Stop distance: "+stopDist.toFixed(4)+" "+tradeCur;
});
