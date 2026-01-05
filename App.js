/* State and persistence (localStorage) */
const store = {
  load() {
    const data = JSON.parse(localStorage.getItem("finance-app") || "{}");
    return {
      transactions: data.transactions || [],
      goals: data.goals || [],
      settings: data.settings || { theme: "light", fontScale: 100, reduceMotion: false }
    };
  },
  save(state) {
    localStorage.setItem("finance-app", JSON.stringify(state));
  }
};

let state = store.load();

/* Accessibility and universal design settings */
const root = document.documentElement;
function applyTheme(theme) {
  root.setAttribute("data-theme", theme);
}
function applyFontScale(scale) {
  root.style.fontSize = `${scale}%`;
}
function applyReducedMotion(enabled) {
  root.style.setProperty("--motion", enabled ? "none" : "auto");
}

/* Tabs */
const tabButtons = document.querySelectorAll(".tab-button");
const tabPanels = document.querySelectorAll(".tab-panel");

function showTab(name) {
  tabButtons.forEach(btn => {
    const selected = btn.dataset.tab === name;
    btn.setAttribute("aria-selected", selected ? "true" : "false");
  });
  tabPanels.forEach(panel => {
    panel.classList.toggle("hidden", panel.id !== `tab-${name}`);
  });
}

/* Init tab */
showTab("chat");

/* Navigation handlers */
tabButtons.forEach(btn => {
  btn.addEventListener("click", () => showTab(btn.dataset.tab));
  btn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      showTab(btn.dataset.tab);
    }
  });
});

/* Chat: simple NLP heuristics */
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatLog = document.getElementById("chat-log");

/* Intent detection helpers */
function parseCurrency(text) {
  // Extract value with patterns like R$50, 50, 50,00
  const match = text.replace(",", ".").match(/(?:R\$\s*)?(\d+(?:\.\d{1,2})?)/i);
  return match ? parseFloat(match[1]) : null;
}
function detectCategory(text) {
  const map = [
    { key: /mercado|supermercado|comida|restaurante|alimenta(ç|c)ão/i, cat: "alimentação" },
    { key: /transporte|uber|ônibus|metro|gasolina|combustível/i, cat: "transporte" },
    { key: /lazer|cinema|jogo|assinatura|stream/i, cat: "lazer" },
    { key: /salario|salário|renda|recebi|ganhei/i, cat: "renda" },
    { key: /aluguel|moradia|condom(í|i)nio|energia|água|internet/i, cat: "moradia" }
  ];
  const found = map.find(m => m.key.test(text));
  return found ? found.cat : "outros";
}
function detectType(text) {
  if (/recebi|ganhei|salario|salário|renda/i.test(text)) return "receita";
  if (/gastei|paguei|comprei|investi|transferi/i.test(text)) return "despesa";
  return "despesa";
}
function detectCorrection(text) {
  const m = text.match(/corrig(ir|o).+?\b(\w+)\b.+?\bpara\b.+?\b(\w+)\b/i);
  if (m) return { from: m[2].toLowerCase(), to: m[3].toLowerCase() };
  // Simple form: "corrigir: mercado vira alimentação"
  const m2 = text.match(/corrigir.*?:\s*(\w+)\s+vira\s+(\w+)/i);
  if (m2) return { from: m2[1].toLowerCase(), to: m2[2].toLowerCase() };
  return null;
}

/* Transactions CRUD */
function addTransaction(tx) {
  state.transactions.push(tx);
  store.save(state);
  renderReports();
  renderGoalProgress();
}
function correctCategory(from, to) {
  let count = 0;
  state.transactions = state.transactions.map(t => {
    if (t.category.toLowerCase().includes(from)) {
      count++;
      return { ...t, category: to };
    }
    return t;
  });
  store.save(state);
  return count;
}

/* Chat rendering */
function addChatMessage(text, role = "assistant") {
  const li = document.createElement("li");
  li.className = "chat-item";

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role}`;
  bubble.textContent = text;

  li.appendChild(bubble);
  chatLog.appendChild(li);
  li.scrollIntoView({ behavior: "smooth", block: "end" });
}

/* Initial assistant welcome */
addChatMessage("Olá! Conte-me seus gastos ou receitas em linguagem natural. Ex.: 'Gastei R$50 no mercado'.");

/* Chat form handler */
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  addChatMessage(text, "user");

  // Correção de categoria
  const correction = detectCorrection(text);
  if (correction) {
    const changed = correctCategory(correction.from, correction.to);
    const resp = changed > 0
      ? `Atualizei ${changed} transação(ões) de "${correction.from}" para "${correction.to}".`
      : `Não encontrei transações com categoria relacionada a "${correction.from}".`;
    addChatMessage(resp);
    chatForm.reset();
    return;
  }

  // Meta via chat
  const metaMatch = text.match(/meta.*?:?\s*(economizar|poupar)\s*R\$\s*(\d+(?:[,.]\d{1,2})?)\s*(?:este mês|nesse mês|mensal)?/i);
  if (metaMatch) {
    const amount = parseFloat(metaMatch[2].replace(",", "."));
    const goal = { amount, category: "", createdAt: Date.now() };
    state.goals = [goal]; // MVP: uma meta ativa
    store.save(state);
    addChatMessage(`Meta salva: economizar R$${amount.toFixed(2)} neste mês.`);
    renderGoalProgress();
    chatForm.reset();
    return;
  }

  // Transação
  const value = parseCurrency(text);
  const type = detectType(text);
  const category = detectCategory(text);

  if (value === null) {
    addChatMessage("Não identifiquei um valor. Tente algo como: 'Gastei R$35 em transporte'.");
    return;
  }

  const tx = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    type, // 'despesa' | 'receita'
    value,
    category,
    note: text,
    date: new Date().toISOString()
  };
  addTransaction(tx);

  // Agent suggestions (simple)
  const tips = {
    alimentação: "Notei gasto em alimentação. Verifique compras por impulso e planeje mercado com lista.",
    transporte: "Gastos de transporte podem cair com rotas alternativas ou caronas.",
    lazer: "Defina um teto semanal de lazer para manter equilíbrio.",
    moradia: "Considere comparar planos de internet/energia e otimizar consumo.",
    renda: "Ótimo! Registrar receitas ajuda a visualizar sobras para metas.",
    outros: "Considere classificar melhor para ver padrões e economias."
  };

  addChatMessage(`Registrei ${type} de R$${value.toFixed(2)} em "${category}".`);
  addChatMessage(tips[category] || tips.outros);

  chatForm.reset();
});

/* Goals */
const goalAmountInput = document.getElementById("goal-amount");
const goalCategoryInput = document.getElementById("goal-category");
const saveGoalBtn = document.getElementById("save-goal");
const goalSummary = document.getElementById("goal-summary");

saveGoalBtn.addEventListener("click", () => {
  const amount = parseFloat(goalAmountInput.value || "0");
  const category = (goalCategoryInput.value || "").trim().toLowerCase();
  if (!amount || amount <= 0) {
    announce("Informe um valor de meta válido.");
    return;
  }
  state.goals = [{ amount, category, createdAt: Date.now() }];
  store.save(state);
  renderGoalProgress();
  announce("Meta financeira salva com sucesso.");
});

function renderGoalProgress() {
  const goal = state.goals[0];
  if (!goal) {
    goalSummary.innerHTML = "<p>Nenhuma meta definida. Crie uma meta para acompanhar seu progresso.</p>";
    return;
  }
  const inMonth = (tx) => {
    const d = new Date(tx.date);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  };
  const spent = state.transactions
    .filter(tx => tx.type === "despesa" && inMonth(tx))
    .filter(tx => !goal.category || tx.category.toLowerCase() === goal.category)
    .reduce((sum, tx) => sum + tx.value, 0);

  const saved = Math.max(goal.amount - spent, 0);
  const pct = goal.amount > 0 ? Math.min((saved / goal.amount) * 100, 100) : 0;

  goalSummary.innerHTML = `
    <p>Meta: economizar R$${goal.amount.toFixed(2)} ${goal.category ? `em ${goal.category}` : "no mês"}.</p>
    <div aria-label="Barra de progresso da meta" style="background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden;">
      <div style="width:${pct.toFixed(0)}%; background: var(--success); color: #fff; padding: 6px 8px;">${pct.toFixed(0)}%</div>
    </div>
    <p>Gasto acumulado: R$${spent.toFixed(2)} | Economia estimada: R$${saved.toFixed(2)}</p>
  `;
}

/* Reports */
const summaryList = document.getElementById("summary-list");
const categoryCanvas = document.getElementById("category-chart");
const weeklyCanvas = document.getElementById("weekly-chart");

function renderReports() {
  // Summary
  const totalDespesa = state.transactions.filter(t => t.type === "despesa").reduce((s, t) => s + t.value, 0);
  const totalReceita = state.transactions.filter(t => t.type === "receita").reduce((s, t) => s + t.value, 0);
  const saldo = totalReceita - totalDespesa;
  summaryList.innerHTML = `
    <li>Total de receitas: R$${totalReceita.toFixed(2)}</li>
    <li>Total de despesas: R$${totalDespesa.toFixed(2)}</li>
    <li>Saldo: R$${saldo.toFixed(2)}</li>
    <li>Transações registradas: ${state.transactions.length}</li>
  `;

  // Category chart (bar)
  drawCategoryBarChart(categoryCanvas, aggregateByCategory());

  // Weekly chart (line)
  drawWeeklyLineChart(weeklyCanvas, aggregateByWeek());
}

function aggregateByCategory() {
  const map = {};
  for (const t of state.transactions) {
    if (t.type !== "despesa") continue;
    const k = t.category || "outros";
    map[k] = (map[k] || 0) + t.value;
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}
function aggregateByWeek() {
  const map = {};
  for (const t of state.transactions) {
    if (t.type !== "despesa") continue;
    const d = new Date(t.date);
    const weekKey = `${d.getFullYear()}-W${getISOWeek(d)}`;
    map[weekKey] = (map[weekKey] || 0) + t.value;
  }
  return Object.entries(map).sort((a, b) => (a[0] > b[0] ? 1 : -1));
}
function getISOWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
}

/* Simple canvas charts without dependencies */
function drawCategoryBarChart(canvas, data) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const padding = 24;
  const chartW = canvas.width - padding * 2;
  const chartH = canvas.height - padding * 2;

  const values = data.map(d => d[1]);
  const labels = data.map(d => d[0]);
  const max = Math.max(...values, 10);
  const barWidth = chartW / (values.length || 1) - 12;

  // Axes
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--border");
  ctx.beginPath();
  ctx.moveTo(padding, canvas.height - padding);
  ctx.lineTo(canvas.width - padding, canvas.height - padding);
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, canvas.height - padding);
  ctx.stroke();

  // Bars
  const primary = getComputedStyle(document.documentElement).getPropertyValue("--primary");
  ctx.fillStyle = primary;

  values.forEach((val, i) => {
    const x = padding + i * (barWidth + 12);
    const h = (val / max) * (chartH - 10);
    const y = canvas.height - padding - h;
    ctx.fillRect(x, y, barWidth, h);

    // Labels
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--fg");
    ctx.font = "12px system-ui";
    const label = `${labels[i].slice(0, 10)}${labels[i].length > 10 ? "…" : ""}`;
    ctx.fillText(label, x, canvas.height - padding + 12);
    ctx.fillText(`R$${val.toFixed(0)}`, x, y - 4);
    ctx.fillStyle = primary;
  });

  if (values.length === 0) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--muted");
    ctx.font = "14px system-ui";
    ctx.fillText("Sem dados de despesas para exibir.", padding, padding + 14);
  }
}

function drawWeeklyLineChart(canvas, data) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const padding = 24;
  const chartW = canvas.width - padding * 2;
  const chartH = canvas.height - padding * 2;

  const values = data.map(d => d[1]);
  const labels = data.map(d => d[0]);
  const max = Math.max(...values, 10);
  const stepX = chartW / (Math.max(values.length - 1, 1));

  // Axes
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--border");
  ctx.beginPath();
  ctx.moveTo(padding, canvas.height - padding);
  ctx.lineTo(canvas.width - padding, canvas.height - padding);
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, canvas.height - padding);
  ctx.stroke();

  // Line
  const primary = getComputedStyle(document.documentElement).getPropertyValue("--primary");
  ctx.strokeStyle = primary;
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((val, i) => {
    const x = padding + i * stepX;
    const y = padding + (1 - (val / max)) * chartH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Points and labels
  ctx.fillStyle = primary;
  values.forEach((val, i) => {
    const x = padding + i * stepX;
    const y = padding + (1 - (val / max)) * chartH;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--fg");
    ctx.font = "12px system-ui";
    ctx.fillText(labels[i].replace(/^(\d{4})-W/, "W"), x - 10, canvas.height - padding + 12);
    ctx.fillText(`R$${val.toFixed(0)}`, x - 12, y - 6);
    ctx.fillStyle = primary;
  });

  if (values.length === 0) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--muted");
    ctx.font = "14px system-ui";
    ctx.fillText("Sem dados semanais para exibir.", padding, padding + 14);
  }
}

/* Settings */
const themeSelect = document.getElementById("theme-select");
const fontScaleInput = document.getElementById("font-scale");
const reduceMotionInput = document.getElementById("prefers-reduced-motion");

function initSettings() {
  applyTheme(state.settings.theme);
  applyFontScale(state.settings.fontScale);
  applyReducedMotion(state.settings.reduceMotion);

  themeSelect.value = state.settings.theme;
  fontScaleInput.value = state.settings.fontScale;
  reduceMotionInput.checked = state.settings.reduceMotion;
}

themeSelect.addEventListener("change", () => {
  state.settings.theme = themeSelect.value;
  applyTheme(state.settings.theme);
  store.save(state);
});
fontScaleInput.addEventListener("input", () => {
  const v = Number(fontScaleInput.value);
  state.settings.fontScale = v;
  applyFontScale(v);
  store.save(state);
});
reduceMotionInput.addEventListener("change", () => {
  const v = reduceMotionInput.checked;
  state.settings.reduceMotion = v;
  applyReducedMotion(v);
  store.save(state);
});

/* Data export/import */
const exportBtn = document.getElementById("export-data");
const importBtn = document.getElementById("import-data");
const importFileInput = document.getElementById("import-file");
const clearBtn = document.getElementById("clear-data");

exportBtn.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "finance-app-data.json";
  a.click();
  URL.revokeObjectURL(url);
  announce("Exportação concluída. Arquivo baixado.");
});

importBtn.addEventListener("click", () => importFileInput.click());
importFileInput.addEventListener("change", async () => {
  const file = importFileInput.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const data = JSON.parse(text);
    // Basic validation
    if (!data || !Array.isArray(data.transactions)) throw new Error("Formato inválido.");
    state = data;
    store.save(state);
    initSettings();
    renderReports();
    renderGoalProgress();
    announce("Importação concluída com sucesso.");
  } catch (err) {
    announce("Falha ao importar. Verifique o arquivo JSON.");
  } finally {
    importFileInput.value = "";
  }
});

clearBtn.addEventListener("click", () => {
  if (confirm("Tem certeza que deseja limpar todos os dados?")) {
    state = { transactions: [], goals: [], settings: state.settings };
    store.save(state);
    renderReports();
    renderGoalProgress();
    chatLog.innerHTML = "";
    addChatMessage("Os dados foram limpos. Podemos recomeçar quando quiser.");
  }
});

/* Live regions / feedback */
function announce(message) {
  addChatMessage(message);
}

/* Initial render */
initSettings();
renderReports();
renderGoalProgress();
