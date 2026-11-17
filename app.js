// =============================================================
// 頁面與互動
// =============================================================
(function () {
  const { DEMO, esc, fmt, fmtPct, cls, fmtVol, timeAgo, md, Auth, DB, api, IND, explain, holdingAdvice, LEARN } = window.Core;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const app = $("#app");

  const LS_SHOW = "sh_show";
  const S = {
    screenMarket: "TW", moverMarket: "TW", newsTab: "world",
    range: "1y",
    show: Object.assign({ ma: true, bb: true, vol: true, kd: true, macd: false, rsi: false }, safeJSON(localStorage.getItem(LS_SHOW))),
    stock: null, ind: null, exp: null, chart: null,
    chat: [],
  };
  function safeJSON(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }

  function toast(msg, ms = 2600) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
  }
  const loadingHTML = (txt = "載入中…") => `<div class="loading">⏳ ${txt}</div>`;
  const fallbackNote = (r) => r && r.demo && r.error && !DEMO
    ? `<div class="alert small" style="margin-bottom:10px">⚠ 即時資料暫時抓不到（${esc(r.error)}），以下暫以<b>示範資料</b>顯示。</div>` : "";

  // ---------- 登入 ----------
  let authMode = "in";
  function showLogin() { $("#login").hidden = false; $("#authErr").textContent = ""; }
  function hideLogin() { $("#login").hidden = true; }
  $("#guestBtn").onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = "進入中…";
    try { await Auth.guest(); hideLogin(); renderUser(); route(); toast("歡迎！你現在是訪客身分"); }
    catch (err) { $("#authErr").textContent = err.message; }
    b.disabled = false; b.textContent = "👀 訪客進入（免註冊，一鍵使用）";
  };
  $$("#authTabs button").forEach((b) => b.onclick = () => {
    authMode = b.dataset.t;
    $$("#authTabs button").forEach((x) => x.classList.toggle("active", x === b));
    $("#authSubmit").textContent = authMode === "in" ? "登入" : "註冊新帳號";
    $("#pw").autocomplete = authMode === "in" ? "current-password" : "new-password";
  });
  $("#authForm").onsubmit = async (e) => {
    e.preventDefault();
    const email = $("#email").value.trim(), pw = $("#pw").value;
    const btn = $("#authSubmit"); btn.disabled = true;
    $("#authErr").textContent = "";
    try {
      if (authMode === "in") { await Auth.signIn(email, pw); }
      else {
        const r = await Auth.signUp(email, pw);
        if (r === "confirm") { $("#authErr").textContent = "註冊成功！請到信箱點擊確認信，再回來登入。"; btn.disabled = false; return; }
      }
      hideLogin(); renderUser(); route(); toast("登入成功");
    } catch (err) { $("#authErr").textContent = err.message; }
    btn.disabled = false;
  };
  function renderUser() {
    const u = Auth.user;
    const box = $("#userBox");
    if (!u) { box.innerHTML = `<button class="btn sm primary" id="loginBtn">登入</button>`; $("#loginBtn").onclick = showLogin; return; }
    const label = Auth.isGuest ? "👀 訪客" : "👤 " + esc(u.email.split("@")[0]);
    box.innerHTML = `<span class="chip">${label}</span><button class="btn sm ghost" id="logoutBtn">${Auth.isGuest ? "改用帳號" : "登出"}</button>`;
    $("#logoutBtn").onclick = async () => { await Auth.signOut(); renderUser(); showLogin(); };
  }

  // ---------- 路由 ----------
  let RID = 0; // 每次換頁 +1，舊頁面的非同步結果回來時就丟掉
  const stale = (rid) => rid !== RID;
  function route() {
    RID++;
    const [page, ...args] = (location.hash.slice(1) || "home").split("/");
    $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.page === page));
    if (S.chart && page !== "stock") { S.chart.ro.disconnect(); S.chart = null; }
    window.scrollTo(0, 0);
    const pages = { home: pageHome, stock: pageStock, watch: pageWatch, news: pageNews, ai: pageAI, about: pageAbout };
    (pages[page] || pageHome)(...args);
  }
  window.addEventListener("hashchange", route);
  const goStock = (market, symbol) => { location.hash = `#stock/${market}/${encodeURIComponent(symbol)}`; };

  // ---------- 共用元件 ----------
  function spark(arr, up) {
    if (!arr || arr.length < 2) return "";
    const mn = Math.min(...arr), mx = Math.max(...arr), w = 100, h = 30;
    const pts = arr.map((v, i) => `${(i / (arr.length - 1) * w).toFixed(1)},${(h - (v - mn) / (mx - mn || 1) * (h - 4) - 2).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline fill="none" stroke="${up ? "var(--up)" : "var(--down)"}" stroke-width="1.6" points="${pts}" vector-effect="non-scaling-stroke"/></svg>`;
  }
  function moversTable(list, market) {
    if (!list || !list.length) return `<div class="empty">沒有資料</div>`;
    return `<div class="scroll-x"><table class="table"><thead><tr><th>#</th><th>股票</th><th class="r">收盤</th><th class="r">漲跌幅</th></tr></thead><tbody>
      ${list.map((r, i) => `<tr class="click" data-m="${market}" data-s="${esc(r.symbol)}">
        <td><span class="rank">${i + 1}</span></td>
        <td><b>${esc(r.name)}</b><span class="code">${esc(r.symbol)}</span></td>
        <td class="r num">${fmt(r.close)}</td>
        <td class="r num ${cls(r.changePct)}"><b>${fmtPct(r.changePct)}</b></td></tr>`).join("")}
      </tbody></table></div>`;
  }
  function bindRows(el) {
    $$("tr.click[data-s], [data-goto]", el).forEach((tr) => tr.onclick = (e) => {
      if (e.target.closest("button")) return;
      const m = tr.dataset.m, s = tr.dataset.s;
      if (s) goStock(m, s);
    });
  }
  function seg(id, opts, active) {
    return `<div class="seg" id="${id}">${opts.map(([v, t]) => `<button data-v="${v}" class="${v === active ? "active" : ""}">${t}</button>`).join("")}</div>`;
  }
  function bindSeg(id, fn) {
    $$(`#${id} button`).forEach((b) => b.onclick = () => {
      $$(`#${id} button`).forEach((x) => x.classList.toggle("active", x === b));
      fn(b.dataset.v);
    });
  }
  function newsList(items, withImg) {
    if (!items || !items.length) return `<div class="empty">目前沒有新聞</div>`;
    return `<div class="news-list">${items.map((n) => `<a class="news-item" href="${esc(n.url)}" target="_blank" rel="noopener">
      ${withImg && n.image ? `<img src="${esc(n.image)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
      <div><div class="t">${esc(n.title)}</div>
      ${n.summary ? `<div class="s">${esc(n.summary)}</div>` : ""}
      <div class="s">${esc(n.source)}${n.time ? " · " + timeAgo(n.time) : ""}</div></div></a>`).join("")}</div>`;
  }
  async function askAI(outEl, payload, btn) {
    if (!Auth.user) { showLogin(); return; }
    outEl.hidden = false;
    outEl.innerHTML = `<div class="typing muted">AI 正在看數據、整理白話說明</div>`;
    if (btn) btn.disabled = true;
    try {
      const r = await api("ai", payload);
      outEl.innerHTML = `<div class="row" style="margin-bottom:4px"><b>🤖 AI 白話解說</b><span class="spacer"></span><button class="btn sm ghost" data-close>✕</button></div>${md(r.data.text)}`;
      $("[data-close]", outEl).onclick = () => (outEl.hidden = true);
    } catch (e) {
      outEl.innerHTML = `<div class="alert">AI 暫時無法回答：${esc(e.message)}</div>`;
    }
    if (btn) btn.disabled = false;
  }

  // =============================================================
  // 首頁
  // =============================================================
  function pageHome() {
    app.innerHTML = `
      <div class="card hero">
        <h1>👋 今天的股市，用白話看懂</h1>
        <p>每天幫你篩出值得留意的股票、看懂技術指標、追蹤自選股，看不懂的地方直接問 AI。</p>
        <div class="row" style="margin-top:12px">
          <div class="search-wrap" style="max-width:420px"><input id="homeSearch" placeholder="輸入股票代號或名稱，例如 2330、台積電、NVDA" /></div>
          <button class="btn" id="homeGo">查詢</button>
        </div>
      </div>
      <div class="section"><div class="grid g6" id="idx">${Array(6).fill('<div class="card idx"><div class="skeleton" style="height:64px"></div></div>').join("")}</div></div>

      <div class="section">
        <div class="section-head"><h2>🎯 今日篩選：技術面值得留意的股票</h2>${seg("scrSeg", [["TW", "台股"], ["US", "美股"]], S.screenMarket)}</div>
        <div id="screen">${loadingHTML("正在掃描股票、計算技術指標（第一次大約需要 20～60 秒）…")}</div>
      </div>

      <div class="section">
        <div class="section-head"><h2>🔥 今日漲跌排行</h2>${seg("movSeg", [["TW", "台股"], ["US", "美股"]], S.moverMarket)}</div>
        <div id="movers">${loadingHTML()}</div>
      </div>

      <div class="section">
        <div class="section-head"><h2>💬 PTT 股票板熱議股</h2><a href="#news" onclick="sessionStorage.setItem('newsTab','ptt')">看更多 →</a></div>
        <div id="hotChips" class="card">${loadingHTML()}</div>
      </div>`;
    bindSearch($("#homeSearch"), $("#homeGo"));
    bindSeg("scrSeg", (v) => { S.screenMarket = v; loadScreen(); });
    bindSeg("movSeg", (v) => { S.moverMarket = v; loadMovers(); });
    loadIndices(); loadScreen(); loadMovers(); loadHotChips();
  }

  async function loadIndices() {
    const r = await api("indices");
    const el = $("#idx"); if (!el) return;
    el.innerHTML = (r.data || []).map((x) => `<div class="card idx">
      <div class="name">${esc(x.name)}</div>
      <div class="price num">${fmt(x.close)}</div>
      <div class="num small ${cls(x.change)}">${x.change > 0 ? "▲" : x.change < 0 ? "▼" : ""} ${fmt(Math.abs(x.change))}（${fmtPct(x.changePct)}）</div>
      ${spark(x.spark, x.change >= 0)}</div>`).join("");
  }

  async function loadScreen() {
    const el = $("#screen"); if (!el) return;
    el.innerHTML = loadingHTML("正在掃描股票、計算技術指標（第一次大約需要 20～60 秒）…");
    const m = S.screenMarket;
    const r = await api("screen", { market: m });
    if (!$("#screen") || S.screenMarket !== m) return;
    const d = r.data;
    const sc = (s) => s >= 4 ? "" : s >= 2 ? "mid" : "low";
    const best = d.picks.length ? d.picks[0].score : 0;
    const downCount = d.picks.filter((p) => p.changePct < 0).length;
    const weakNote = best < 3 ? `<div class="alert" style="margin-bottom:12px">📉 <b>今天市場整體偏弱</b>：掃描的 ${d.scanned} 檔裡，沒有任何一檔技術面分數達到 3 分以上（前 ${d.picks.length} 名中有 ${downCount} 檔今天下跌）。
      這種時候<b>「先觀望、不急著買」也是一種策略</b>。下面依分數列出「相對沒那麼弱」的股票，只供觀察參考。</div>` : "";
    el.innerHTML = fallbackNote(r) + weakNote + `
      <p class="muted small" style="margin:0 0 10px">掃描範圍：${esc(d.universeNote)}（共 ${d.scanned} 檔）。依「站上均線、黃金交叉、帶量上漲、RSI 健康」等條件加分，「過熱」扣分。<b>分數高只代表技術面條件好，不代表一定會漲。</b></p>
      <div class="grid g3">${d.picks.map((p) => `
        <div class="card pick">
          <div class="top"><span class="nm">${esc(p.name)}</span><span class="code">${esc(p.symbol)}</span>
            <span class="score ${sc(p.score)}">${p.score} 分</span></div>
          <div class="row num"><b>${fmt(p.close)}</b><span class="${cls(p.changePct)}">${fmtPct(p.changePct)}</span>
            <span class="muted small">RSI ${fmt(p.rsi, 0)}｜K ${fmt(p.k, 0)}</span></div>
          <div class="tags">${p.good.map((g) => `<span class="tag">✓ ${esc(g)}</span>`).join("")}${p.warn.map((w) => `<span class="tag warn">! ${esc(w)}</span>`).join("")}</div>
          <div class="row" style="margin-top:auto">
            <button class="btn sm primary" data-chart="${esc(p.symbol)}">📊 看圖表與解說</button>
            <button class="btn sm" data-add="${esc(p.symbol)}" data-name="${esc(p.name)}">⭐ 加入自選</button>
          </div>
        </div>`).join("")}</div>`;
    $$("[data-chart]", el).forEach((b) => b.onclick = () => goStock(m, b.dataset.chart));
    $$("[data-add]", el).forEach((b) => b.onclick = () => addWatch(m, b.dataset.add, b.dataset.name));
  }

  async function loadMovers() {
    const el = $("#movers"); if (!el) return;
    el.innerHTML = loadingHTML();
    const m = S.moverMarket;
    const r = await api("movers", { market: m });
    if (!$("#movers") || S.moverMarket !== m) return;
    const d = r.data;
    el.innerHTML = fallbackNote(r) + `<p class="muted small" style="margin:0 0 10px">資料日期：${esc(d.date)}｜來源：${esc(d.source)}${m === "TW" ? "｜僅統計成交量 500 張以上的上市個股" : ""}</p>
      <div class="grid g2">
        <div class="card"><h3 class="up">📈 漲幅前十</h3>${moversTable(d.gainers, m)}</div>
        <div class="card"><h3 class="down">📉 跌幅前十</h3>${moversTable(d.losers, m)}</div>
      </div>`;
    bindRows(el);
  }

  async function loadHotChips() {
    const r = await api("ptt");
    const el = $("#hotChips"); if (!el) return;
    const hs = r.data?.hotStocks || [];
    el.innerHTML = fallbackNote(r) + (hs.length ? `<div class="chips">${hs.slice(0, 8).map((h, i) =>
      `<button data-m="TW" data-s="${esc(h.symbol)}">${i < 3 ? "🔥" : ""} ${esc(h.name)} ${esc(h.symbol)} <span class="muted">· ${h.mentions} 篇</span></button>`).join("")}</div>
      <p class="muted small" style="margin:8px 0 0">統計最近幾頁 PTT 股票板文章標題中被提到的股票（篇數越多代表討論越熱烈）。</p>`
      : `<div class="empty">目前沒有統計到熱議股</div>`);
    $$("button[data-s]", el).forEach((b) => b.onclick = () => goStock("TW", b.dataset.s));
  }

  // 搜尋（台股可打名稱；美股直接打代號）
  function bindSearch(input, btn, marketGetter) {
    const wrap = input.parentElement;
    let box = null, timer = null;
    const close = () => { box?.remove(); box = null; };
    const go = (sym, market) => {
      sym = (sym || input.value).trim();
      if (!sym) return;
      close();
      const lettersOnly = /^[A-Za-z^.\-]+$/.test(sym);
      const m = market || (lettersOnly ? "US" : (marketGetter ? marketGetter() : "TW"));
      if (m === "TW" && !/^\d{4,6}[A-Z]?$/i.test(sym)) {
        api("search", { q: sym }, { noFallback: false }).then((r) => {
          const hit = (r.data || [])[0];
          if (hit) goStock("TW", hit.symbol); else toast("找不到這檔股票，請改用代號查詢");
        });
        return;
      }
      goStock(m, sym.toUpperCase());
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); if (e.key === "Escape") close(); });
    btn.onclick = () => go();
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (!q || /^[A-Za-z]+$/.test(q)) { close(); return; }
      timer = setTimeout(async () => {
        const r = await api("search", { q });
        const list = r.data || [];
        close();
        if (!list.length) return;
        box = document.createElement("div"); box.className = "suggest";
        box.innerHTML = list.map((x) => `<div data-s="${esc(x.symbol)}"><b>${esc(x.symbol)}</b> ${esc(x.name)}</div>`).join("");
        wrap.appendChild(box);
        $$("div[data-s]", box).forEach((d) => d.onclick = () => go(d.dataset.s, "TW"));
      }, 250);
    });
    document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) close(); });
  }

  async function addWatch(market, symbol, name) {
    if (!Auth.user) { showLogin(); return; }
    try { await DB.add({ market, symbol, name }); toast(`已把 ${name || symbol} 加入自選股 ⭐`); }
    catch (e) { toast(e.message); }
  }

  // =============================================================
  // 個股分析
  // =============================================================
  const QUICK = [["TW", "2330", "台積電"], ["TW", "2317", "鴻海"], ["TW", "2454", "聯發科"], ["TW", "2603", "長榮"], ["US", "NVDA", "輝達"], ["US", "AAPL", "蘋果"], ["US", "TSLA", "特斯拉"]];
  const TOGGLES = [["ma", "均線"], ["bb", "布林通道"], ["vol", "成交量"], ["kd", "KD"], ["macd", "MACD"], ["rsi", "RSI"]];

  function pageStock(market, symbol) {
    market = market === "US" ? "US" : "TW";
    symbol = decodeURIComponent(symbol || "") || (market === "US" ? "NVDA" : "2330");
    let curMarket = market;
    app.innerHTML = `
      <div class="card">
        <div class="row">
          ${seg("mkSeg", [["TW", "台股"], ["US", "美股"]], market)}
          <div class="search-wrap"><input id="stkSearch" placeholder="台股：代號或名稱（2330、台積電）｜美股：代號（NVDA、AAPL）" /></div>
          <button class="btn primary" id="stkGo">查詢</button>
        </div>
        <div class="chips" style="margin-top:10px">${QUICK.map(([m, s, n]) => `<button data-m="${m}" data-s="${s}">${n} ${s}</button>`).join("")}</div>
      </div>
      <div id="stk" class="section">${loadingHTML("正在抓取股價資料…")}</div>`;
    bindSeg("mkSeg", (v) => { curMarket = v; });
    bindSearch($("#stkSearch"), $("#stkGo"), () => curMarket);
    $$(".chips button[data-s]").forEach((b) => b.onclick = () => goStock(b.dataset.m, b.dataset.s));
    loadStock(market, symbol);
  }

  async function loadStock(market, symbol) {
    const rid = RID;
    const r = await api("history", { market, symbol, range: "2y" });
    const el = $("#stk");
    if (stale(rid) || !el) return;
    const h = r.data;
    if (!h || !h.candles || h.candles.length < 30) { el.innerHTML = `<div class="card empty">找不到 ${esc(symbol)} 的資料，請確認代號是否正確（台股上櫃股票也可以查）。</div>`; return; }
    S.stock = h; S.stockDemo = r.demo;
    S.ind = IND.all(h.candles);
    const c = h.candles, last = c.at(-1), prev = c.at(-2);
    const chg = last.close - prev.close, chgPct = (last.close / prev.close - 1) * 100;
    const y = c.slice(-250);
    const hi52 = Math.max(...y.map((x) => x.high)), lo52 = Math.min(...y.map((x) => x.low));
    el.innerHTML = fallbackNote(r) + `
      <div class="card">
        <div class="stock-head">
          <div><div class="nm">${esc(h.name)} <span class="code" style="font-size:15px">${esc(h.symbol)}・${market === "TW" ? "台股" : "美股"}</span></div>
            <div class="muted small">資料日期 ${esc(last.time)}｜來源 ${esc(h.source)}｜幣別 ${esc(h.currency)}</div></div>
          <div class="px num ${cls(chg)}">${fmt(last.close)}</div>
          <div class="num ${cls(chg)}" style="font-weight:700">${chg > 0 ? "▲" : chg < 0 ? "▼" : ""} ${fmt(Math.abs(chg))}（${fmtPct(chgPct)}）</div>
          <div class="muted small num">52 週高 ${fmt(hi52)}／低 ${fmt(lo52)}<br>成交量 ${fmtVol(last.volume)} 股</div>
          <span class="spacer"></span>
          <button class="btn" id="addBtn">⭐ 加入自選</button>
          <button class="btn ai" id="aiBtn">🤖 AI 白話解說這檔</button>
        </div>
        <div id="aiOut" class="ai-box" style="margin-top:14px" hidden></div>
      </div>

      <div class="card">
        <div class="row" style="margin-bottom:10px">
          <b>想看哪些指標？</b>
          <div class="toggles" id="tgl">${TOGGLES.map(([k, t]) => `<label class="toggle ${S.show[k] ? "on" : ""}"><input type="checkbox" data-k="${k}" ${S.show[k] ? "checked" : ""}><span class="dot"></span>${t}</label>`).join("")}</div>
          <span class="spacer"></span>
          ${seg("rgSeg", [["3m", "3個月"], ["6m", "6個月"], ["1y", "1年"], ["2y", "2年"]], S.range)}
        </div>
        <div class="chart-layout">
          <div>
            <div class="chart-box" id="chartBox"></div>
            <div class="chart-hint">💡 滑鼠移到圖上看每天的數字；滾輪縮放、拖曳左右移動（手機可以用手指拖曳、點一下看數字）。
              圖上的 ▲▼ 是系統自動標出的訊號。<span class="up">紅色 K 棒＝收盤比開盤高</span>、<span class="down">綠色＝收盤比開盤低</span>。</div>
          </div>
          <div class="notes" id="notes"></div>
        </div>
      </div>

      <div class="card">
        <h3>📰 ${esc(h.name)} 相關新聞</h3>
        <div id="stkNews">${loadingHTML()}</div>
      </div>`;

    S.chart = new StockChart($("#chartBox"));
    drawStock();
    $$("#tgl input").forEach((cb) => cb.onchange = () => {
      S.show[cb.dataset.k] = cb.checked;
      cb.parentElement.classList.toggle("on", cb.checked);
      localStorage.setItem(LS_SHOW, JSON.stringify(S.show));
      drawStock();
    });
    const RG = { "3m": 63, "6m": 126, "1y": 250, "2y": 500 };
    S.chart.setRange(RG[S.range]);
    bindSeg("rgSeg", (v) => { S.range = v; S.chart.setRange(RG[v]); });
    $("#addBtn").onclick = () => addWatch(market, h.symbol, h.name);
    $("#aiBtn").onclick = (e) => askAI($("#aiOut"), { mode: "explain", question: `請用白話幫我解讀 ${h.name}（${h.symbol}）目前的技術面：趨勢如何、哪些訊號值得注意、如果我想買或已經持有，各要注意什麼？`, context: stockContext() }, e.currentTarget);

    api("news", { type: "stock", market, symbol: h.symbol, name: h.name }).then((nr) => {
      const ne = $("#stkNews"); if (!ne) return;
      ne.innerHTML = fallbackNote(nr) + newsList([...(nr.data?.chinese || []), ...(nr.data?.international || [])].slice(0, 12), true);
    });
  }

  function drawStock() {
    const h = S.stock, ind = S.ind;
    S.exp = explain(h.candles, ind, S.show);
    S.chart.setData(h.candles, ind, S.show, S.exp.markers);
    const sm = S.exp.summary;
    const icon = { good: "🟢", warn: "🟠", info: "⚪" }[sm.level];
    $("#notes").innerHTML = `
      <div class="summary-light ${sm.level}"><span class="big">${icon}</span>
        <div><b>綜合技術面：${esc(sm.label)}</b>
        <div class="small muted">${sm.good.length ? "✓ " + sm.good.map(esc).join("、") : ""}${sm.warn.length ? "<br>! " + sm.warn.map(esc).join("、") : ""}</div></div></div>
      <div class="muted small" style="margin-top:-2px">📝 圖表解說（系統依最新一天數據自動產生）</div>
      ${S.exp.notes.length ? S.exp.notes.map((n) => `
        <div class="note ${n.level}">
          <h4>${{ good: "🟢", warn: "🟠", info: "🔵" }[n.level]} ${esc(n.title)}</h4>
          <p>${esc(n.text)}</p>
          <details><summary>這是什麼？</summary>${esc(LEARN[n.key])}</details>
          <div class="acts"><button class="btn sm" data-ask="${n.key}">🤖 還是看不懂？問 AI</button></div>
        </div>`).join("") : `<div class="note">請在上方勾選想看的指標</div>`}`;
    $$("[data-ask]", $("#notes")).forEach((b) => b.onclick = () => {
      const n = S.exp.notes.find((x) => x.key === b.dataset.ask);
      $("#aiOut").scrollIntoView({ behavior: "smooth", block: "center" });
      askAI($("#aiOut"), { mode: "explain", question: `我是投資新手，請用更白話、舉生活例子的方式解釋：${h.name} 目前的「${n.title}」是什麼狀況？圖上要看哪裡？對我來說代表什麼？`, context: stockContext([n.key]) }, b);
    });
  }

  function stockContext(only) {
    const h = S.stock, c = h.candles, ind = S.ind, i = c.length - 1;
    const r2 = (v) => v == null || !isFinite(v) ? null : Math.round(v * 100) / 100;
    const ret = (n) => c[i - n] ? r2((c[i].close / c[i - n].close - 1) * 100) : null;
    const y = c.slice(-250);
    return {
      stock: { name: h.name, symbol: h.symbol, market: h.market === "US" ? "美股" : "台股", currency: h.currency },
      date: c[i].time, close: c[i].close, changePct: ret(1),
      return_5d_pct: ret(5), return_1m_pct: ret(21), return_3m_pct: ret(63),
      high_52w: Math.max(...y.map((x) => x.high)), low_52w: Math.min(...y.map((x) => x.low)),
      last_10_closes: c.slice(-10).map((x) => x.close),
      volume: c[i].volume, volume_avg20: r2(ind.volMa[i]),
      ma5: r2(ind.ma5[i]), ma20: r2(ind.ma20[i]), ma60: r2(ind.ma60[i]),
      bollinger: { upper: r2(ind.bbUp[i]), middle: r2(ind.bbMid[i]), lower: r2(ind.bbLo[i]) },
      kd: { K: r2(ind.K[i]), D: r2(ind.D[i]), K_prev: r2(ind.K[i - 1]), D_prev: r2(ind.D[i - 1]) },
      macd: { DIF: r2(ind.dif[i]), signal: r2(ind.sig[i]), histogram: r2(ind.hist[i]), histogram_prev: r2(ind.hist[i - 1]) },
      rsi14: r2(ind.rsi[i]),
      summary: S.exp.summary,
      notes: S.exp.notes.filter((n) => !only || only.includes(n.key)).map((n) => ({ title: n.title, text: n.text })),
    };
  }

  // =============================================================
  // 我的自選股
  // =============================================================
  async function pageWatch() {
    if (!Auth.user) { app.innerHTML = `<div class="card empty">請先登入或按「訪客進入」<br><br><button class="btn primary" id="lg">登入 / 訪客進入</button></div>`; $("#lg").onclick = showLogin; return; }
    app.innerHTML = `
      <div class="card">
        <h2>⭐ 我的自選股與持股提醒</h2>
        <p class="muted small">輸入股票就能看分析；如果有填<b>買進成本</b>，系統會依你設定的停損／停利幫你檢查「是不是該賣了」。</p>
        ${Auth.isGuest ? `<div class="alert info small" style="margin:8px 0">👀 你目前是訪客：自選股會保存在這個訪客身分，<b>登出或清除瀏覽器資料後就會消失</b>。想長期保存，請按右上角「改用帳號」註冊。</div>` : ""}
        <form id="addForm" class="add-form" style="margin-top:10px">
          <label>市場<select id="fMk"><option value="TW">台股</option><option value="US">美股</option></select></label>
          <label>股票代號<input id="fSym" placeholder="2330 或 NVDA" required /></label>
          <label>買進成本（每股，可不填）<input id="fCost" type="number" step="any" min="0" placeholder="例如 950" /></label>
          <label>股數（可不填）<input id="fSh" type="number" step="any" min="0" placeholder="例如 1000" /></label>
          <label>停損 %<input id="fSl" type="number" step="any" min="0" value="8" /></label>
          <label>停利 %<input id="fTp" type="number" step="any" min="0" value="20" /></label>
          <button class="btn primary" type="submit">＋ 加入</button>
        </form>
      </div>
      <div class="card" id="wl">${loadingHTML()}</div>`;
    $("#addForm").onsubmit = async (e) => {
      e.preventDefault();
      const market = $("#fMk").value;
      let symbol = $("#fSym").value.trim().toUpperCase();
      const n = (v) => v === "" ? null : Number(v);
      if (market === "TW" && !/^\d{4,6}[A-Z]?$/.test(symbol)) {
        const r = await api("search", { q: $("#fSym").value.trim() });
        if (!r.data?.length) { toast("找不到這檔台股，請輸入代號"); return; }
        symbol = r.data[0].symbol;
      }
      const hr = await api("history", { market, symbol, range: "6mo" });
      if (!hr.data?.candles?.length) { toast("找不到這檔股票的資料"); return; }
      try {
        await DB.add({ market, symbol, name: hr.data.name, cost: n($("#fCost").value), shares: n($("#fSh").value), stop_loss_pct: n($("#fSl").value) ?? 8, take_profit_pct: n($("#fTp").value) ?? 20 });
        toast(`已加入 ${hr.data.name}`);
        e.target.reset(); $("#fSl").value = 8; $("#fTp").value = 20;
        loadWatch();
      } catch (err) { toast(err.message); }
    };
    loadWatch();
  }

  async function loadWatch() {
    const rid = RID;
    const el = $("#wl");
    let rows;
    try { rows = await DB.list(); } catch (e) { el.innerHTML = `<div class="alert">${esc(e.message)}</div>`; return; }
    if (!rows.length) { el.innerHTML = `<div class="empty">還沒有自選股，從上面加入第一檔吧！<br>也可以在首頁的「今日篩選」直接按「⭐ 加入自選」。</div>`; return; }
    el.innerHTML = `<div class="row" style="margin-bottom:12px"><h3 style="margin:0">共 ${rows.length} 檔</h3><span class="spacer"></span>
      <button class="btn ai" id="aiAll">🤖 AI 幫我健檢所有持股</button></div>
      <div id="aiWl" class="ai-box" hidden style="margin-bottom:14px"></div>
      <div id="wlRows">${rows.map((r) => `<div class="hold" data-id="${r.id}">${loadingHTML(esc(r.name || r.symbol))}</div>`).join("")}</div>`;
    if (stale(rid)) return;
    const results = await Promise.all(rows.map(async (row) => {
      const hr = await api("history", { market: row.market, symbol: row.symbol, range: "6mo" });
      const c = hr.data?.candles || [];
      if (c.length < 30) return { row, err: true };
      const ind = IND.all(c);
      return { row, c, ind, adv: holdingAdvice(row, c, ind), demo: hr.demo };
    }));
    if (stale(rid) || !$("#aiAll")) return;
    results.forEach((res) => renderHold(res));
    $("#aiAll").onclick = (e) => {
      const ctx = results.filter((x) => !x.err).map(({ row, c, adv }) => ({
        name: row.name, symbol: row.symbol, market: row.market === "US" ? "美股" : "台股",
        price: adv.price, change_today_pct: Math.round((c.at(-1).close / c.at(-2).close - 1) * 10000) / 100,
        cost: row.cost, shares: row.shares,
        profit_pct: row.cost ? Math.round((adv.price / row.cost - 1) * 10000) / 100 : null,
        stop_loss_pct: row.stop_loss_pct, take_profit_pct: row.take_profit_pct,
        system_status: adv.status.text, system_reasons: adv.tips,
      }));
      askAI($("#aiWl"), { mode: "portfolio", question: "請幫我健檢這些自選股／持股：哪些狀況不錯可以續抱、哪些該留意或考慮賣出？請用白話逐檔說明，最後給整體建議（例如是否太集中在同一產業）。", context: { holdings: ctx } }, e.currentTarget);
    };
  }

  function renderHold({ row, c, ind, adv, err, demo }) {
    const el = $(`.hold[data-id="${row.id}"]`);
    if (!el) return;
    const del = `<button class="btn sm ghost danger" data-del>刪除</button>`;
    if (err) { el.innerHTML = `<div><b>${esc(row.name || row.symbol)}</b> <span class="code">${esc(row.symbol)}</span></div><div class="muted">抓不到資料</div><div></div><div></div>${del}`; bindHold(el, row); return; }
    const last = c.at(-1), prev = c.at(-2);
    const chgPct = (last.close / prev.close - 1) * 100;
    const pl = row.cost ? (last.close / row.cost - 1) * 100 : null;
    const plAmt = row.cost && row.shares ? (last.close - row.cost) * row.shares : null;
    const cur = row.market === "US" ? "US$" : "NT$";
    el.innerHTML = `
      <div><a href="#stock/${row.market}/${encodeURIComponent(row.symbol)}"><b>${esc(row.name || row.symbol)}</b></a><span class="code">${esc(row.symbol)}・${row.market === "TW" ? "台股" : "美股"}</span>
        ${demo && !DEMO ? `<div class="small muted">（示範資料）</div>` : ""}</div>
      <div class="num"><b>${fmt(last.close)}</b><div class="small ${cls(chgPct)}">${fmtPct(chgPct)}（今日）</div></div>
      <div class="num">${pl == null ? `<span class="muted small">未填成本<br>僅觀察</span>` :
        `<b class="${cls(pl)}">${fmtPct(pl)}</b><div class="small muted">成本 ${fmt(row.cost)}${plAmt != null ? `<br><span class="${cls(plAmt)}">${plAmt >= 0 ? "+" : ""}${cur}${fmt(plAmt, 0)}</span>` : ""}</div>`}</div>
      <div><span class="badge ${adv.status.level}">${{ bad: "🔴", good: "🟢", warn: "🟠", info: "⚪" }[adv.status.level]} ${esc(adv.status.text)}</span>
        <ul class="tips">${adv.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
        <div class="small muted">停損 -${row.stop_loss_pct ?? 8}%｜停利 +${row.take_profit_pct ?? 20}%</div></div>
      <div class="row" style="flex-direction:column;align-items:stretch;gap:4px">
        <a class="btn sm" href="#stock/${row.market}/${encodeURIComponent(row.symbol)}">📊 圖表</a>
        <button class="btn sm" data-edit>✏️ 編輯</button>${del}</div>`;
    bindHold(el, row);
  }
  function bindHold(el, row) {
    const d = $("[data-del]", el);
    if (d) d.onclick = async () => {
      if (!confirm(`確定要刪除 ${row.name || row.symbol}？`)) return;
      try { await DB.remove(row.id); el.remove(); toast("已刪除"); } catch (e) { toast(e.message); }
    };
    const ed = $("[data-edit]", el);
    if (ed) ed.onclick = () => {
      el.innerHTML = `<div style="grid-column:1/-1"><b>編輯 ${esc(row.name || row.symbol)}</b>
        <div class="add-form" style="grid-template-columns:repeat(4,1fr) auto auto;margin-top:8px">
          <label>買進成本<input data-f="cost" type="number" step="any" value="${row.cost ?? ""}"></label>
          <label>股數<input data-f="shares" type="number" step="any" value="${row.shares ?? ""}"></label>
          <label>停損 %<input data-f="stop_loss_pct" type="number" step="any" value="${row.stop_loss_pct ?? 8}"></label>
          <label>停利 %<input data-f="take_profit_pct" type="number" step="any" value="${row.take_profit_pct ?? 20}"></label>
          <button class="btn primary" data-save>儲存</button><button class="btn ghost" data-cancel>取消</button></div></div>`;
      $("[data-cancel]", el).onclick = () => loadWatch();
      $("[data-save]", el).onclick = async () => {
        const patch = {};
        $$("[data-f]", el).forEach((i) => patch[i.dataset.f] = i.value === "" ? null : Number(i.value));
        try { await DB.update(row.id, patch); toast("已儲存"); loadWatch(); } catch (e) { toast(e.message); }
      };
    };
  }

  // =============================================================
  // 新聞熱議
  // =============================================================
  function pageNews() {
    const t = sessionStorage.getItem("newsTab"); if (t) { S.newsTab = t; sessionStorage.removeItem("newsTab"); }
    app.innerHTML = `
      <div class="section-head"><h2>📰 新聞與熱門討論</h2>${seg("nwSeg", [["world", "🌍 國際財經"], ["tw", "🇹🇼 台股新聞"], ["ptt", "💬 PTT 熱議"]], S.newsTab)}</div>
      <div id="nw">${loadingHTML()}</div>`;
    bindSeg("nwSeg", (v) => { S.newsTab = v; loadNews(); });
    loadNews();
  }
  async function loadNews() {
    const el = $("#nw"); const tab = S.newsTab;
    el.innerHTML = loadingHTML();
    if (tab === "ptt") {
      const r = await api("ptt");
      if (S.newsTab !== tab || !$("#nw")) return;
      const d = r.data;
      const pc = (p) => p >= 50 ? "hot" : p >= 10 ? "warm" : "cool";
      el.innerHTML = fallbackNote(r) + `<div class="grid g2">
        <div class="card"><h3>🔥 最常被討論的股票</h3>
          <p class="muted small">統計 PTT 股票板最近約 ${d.total} 篇文章標題提到的上市股票</p>
          ${d.hotStocks.length ? `<table class="table"><thead><tr><th>#</th><th>股票</th><th class="r">提到篇數</th><th class="r">總推文</th></tr></thead><tbody>
            ${d.hotStocks.map((s, i) => `<tr class="click" data-m="TW" data-s="${esc(s.symbol)}"><td><span class="rank">${i + 1}</span></td><td><b>${esc(s.name)}</b><span class="code">${esc(s.symbol)}</span></td><td class="r">${s.mentions}</td><td class="r">${s.push}</td></tr>`).join("")}
          </tbody></table>` : `<div class="empty">沒有統計到</div>`}</div>
        <div class="card"><h3>💬 推文最多的文章</h3>
          <div class="news-list">${d.hotPosts.map((p) => `<a class="news-item" href="${esc(p.url)}" target="_blank" rel="noopener">
            <span class="push ${pc(p.push)}">${p.push >= 100 ? "爆" : p.push}</span><div><div class="t">${esc(p.title)}</div><div class="s">${esc(p.author)} ${esc(p.date)}</div></div></a>`).join("")}</div></div>
      </div>
      <p class="muted small">⚠ 網路討論熱度高不代表股票好，有時反而是「人多的地方不要去」，請當作市場情緒的參考。</p>`;
      bindRows(el);
      return;
    }
    const r = await api("news", { type: tab });
    if (S.newsTab !== tab || !$("#nw")) return;
    const d = r.data;
    if (tab === "world") {
      el.innerHTML = fallbackNote(r) + `
        <div class="card" style="margin-bottom:16px">
          <div class="row"><b>看不懂英文新聞？</b><span class="muted small">讓 AI 讀完今天的國際新聞，用中文白話告訴你重點和對股市的可能影響</span><span class="spacer"></span>
          <button class="btn ai" id="aiNews">🤖 AI 幫我整理今日國際重點</button></div>
          <div id="aiNw" class="ai-box" hidden style="margin-top:12px"></div>
        </div>
        <div class="grid g2">
          <div class="card"><h3>🌍 國際財經新聞（英文・Finnhub）</h3>${newsList(d.international, true)}</div>
          <div class="card"><h3>🗞 國際股市中文新聞</h3>${newsList(d.chinese)}</div>
        </div>`;
      $("#aiNews").onclick = (e) => {
        const heads = [...(d.international || []).slice(0, 15).map((n) => ({ title: n.title, summary: n.summary, source: n.source })), ...(d.chinese || []).slice(0, 10).map((n) => ({ title: n.title, source: n.source }))];
        askAI($("#aiNw"), { mode: "news", question: "請閱讀這些今天的國際財經新聞標題與摘要，用繁體中文白話整理：1) 今天最重要的 3～5 件事（每件一句話說明）；2) 這些事對美股、台股可能的影響（哪些產業可能受惠或受傷）；3) 新手該怎麼看待。不要編造新聞裡沒有的內容。", context: { date: new Date().toISOString().slice(0, 10), headlines: heads } }, e.currentTarget);
      };
    } else {
      el.innerHTML = fallbackNote(r) + `<div class="card"><h3>🇹🇼 台股最新新聞（Google 新聞）</h3>${newsList(d.chinese)}</div>`;
    }
  }

  // =============================================================
  // AI 小幫手（聊天）
  // =============================================================
  function pageAI() {
    const hasStock = !!S.stock;
    app.innerHTML = `
      <div class="card chat">
        <div class="row" style="margin-bottom:8px"><h2 style="margin:0">🤖 AI 小幫手</h2><span class="muted small">由 Groq 免費 AI 提供｜任何投資名詞都可以問</span>
          <span class="spacer"></span><button class="btn sm ghost" id="clr">清除對話</button></div>
        ${hasStock ? `<label class="small" style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><input type="checkbox" id="withStock" checked> 附上我剛剛在看的「${esc(S.stock.name)} ${esc(S.stock.symbol)}」數據，讓 AI 根據它回答</label>` : ""}
        <div class="chat-log" id="log"></div>
        <div class="chips" id="sugg">
          ${["布林通道要怎麼看？", "KD 黃金交叉是什麼意思？", "新手怎麼設定停損停利？", "本益比是什麼？", "ETF 跟個股差在哪？", ...(hasStock ? [`${S.stock.name} 現在的走勢怎麼樣？`] : [])].map((q) => `<button>${esc(q)}</button>`).join("")}
        </div>
        <div class="chat-input"><textarea id="q" placeholder="輸入問題，例如：MACD 翻紅代表什麼？（Enter 送出，Shift+Enter 換行）"></textarea><button class="btn primary" id="send">送出</button></div>
      </div>`;
    const log = $("#log");
    const render = () => {
      log.innerHTML = S.chat.length ? S.chat.map((m) => `<div class="msg ${m.role === "user" ? "user" : "bot"}">${m.role === "user" ? esc(m.content) : md(m.content)}</div>`).join("")
        : `<div class="msg bot"><p>嗨！我是股市小幫手 👋</p><p>看不懂的指標、新聞、名詞都可以問我。我會盡量用白話解釋。</p><p class="small muted">提醒：我的回答是學習用的資料解讀，不是投資建議喔。</p></div>`;
      log.scrollTop = log.scrollHeight;
    };
    render();
    const send = async (text) => {
      text = (text || $("#q").value).trim();
      if (!text) return;
      if (!Auth.user) { showLogin(); return; }
      $("#q").value = "";
      const history = S.chat.slice(-8);
      S.chat.push({ role: "user", content: text });
      render();
      log.insertAdjacentHTML("beforeend", `<div class="msg bot typing muted" id="typing">思考中</div>`);
      log.scrollTop = log.scrollHeight;
      $("#send").disabled = true;
      try {
        const ctx = hasStock && $("#withStock")?.checked ? stockContext() : undefined;
        const r = await api("ai", { mode: "chat", question: text, history, context: ctx });
        S.chat.push({ role: "assistant", content: r.data.text });
      } catch (e) {
        S.chat.push({ role: "assistant", content: "抱歉，AI 暫時無法回答：" + e.message });
      }
      $("#send").disabled = false;
      render();
    };
    $("#send").onclick = () => send();
    $("#q").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    $$("#sugg button").forEach((b) => b.onclick = () => send(b.textContent));
    $("#clr").onclick = () => { S.chat = []; render(); };
  }

  // =============================================================
  // 關於（給老師看的系統說明）
  // =============================================================
  function pageAbout() {
    app.innerHTML = `
      <div class="card about">
        <h2>ℹ️ 關於「股市小幫手」</h2>
        <p>一個打開連結就能用的網站：每天幫使用者篩選值得留意的台股／美股、把技術指標畫成圖表並用白話自動解說，看不懂可以直接問 AI；也能建立自己的自選股，系統會依停損／停利條件提醒是否該賣出。</p>

        <h3 style="margin-top:18px">🧩 主要功能</h3>
        <ul>
          <li><b>帳號與訪客模式</b>：每個人有自己的帳號與自選股，資料互不干擾；也可以一鍵「訪客進入」免註冊使用。</li>
          <li><b>今日篩選</b>：掃描台股成交金額前 40 大與美股熱門大型股，依均線、KD、MACD、RSI、成交量等條件評分。</li>
          <li><b>漲跌排行</b>：台股（證交所）與美股當日漲跌幅前十名。</li>
          <li><b>個股圖表</b>：K 線、均線、布林通道、成交量、KD、MACD、RSI 可自由勾選；圖上自動標記黃金／死亡交叉、突破布林軌道、爆量等訊號。</li>
          <li><b>白話解說</b>：每個指標旁都有系統自動產生的文字說明與「這是什麼？」教學，還能一鍵請 AI 更白話地解釋。</li>
          <li><b>自選股與賣出提醒</b>：輸入買進成本與停損／停利 %，自動計算損益並判斷是否觸發賣出條件；AI 可一次健檢所有持股。</li>
          <li><b>新聞與熱議</b>：國際財經新聞（Finnhub）、中文新聞（Google 新聞）、PTT 股票板熱門文章與最常被討論的股票；AI 可以把英文國際新聞整理成中文重點。</li>
        </ul>

        <h3 style="margin-top:18px">🏗 系統架構（全部使用免費服務）</h3>
        <div class="flow">
          <div class="box">使用者瀏覽器<br><span class="muted small">GitHub Pages 網站</span></div><span class="arr">⇄</span>
          <div class="box">Supabase<br><span class="muted small">帳號登入・資料庫・後端函式</span></div><span class="arr">⇄</span>
          <div class="box">外部資料<br><span class="muted small">證交所・Yahoo・Finnhub・新聞・PTT</span></div><span class="arr">＋</span>
          <div class="box">Groq AI<br><span class="muted small">開源大型語言模型</span></div>
        </div>
        <ul>
          <li><b>前端</b>：HTML／CSS／JavaScript，K 線圖為自行用 Canvas 撰寫的圖表引擎，不依賴外部圖表套件。</li>
          <li><b>後端</b>：Supabase Edge Function（TypeScript／Deno），負責抓資料、計算篩選、呼叫 AI，並把結果快取在資料庫以節省 API 額度。</li>
          <li><b>資料庫與安全</b>：PostgreSQL＋列層級安全（Row Level Security），每位使用者只能讀寫自己的自選股；API 金鑰只放在後端，不會出現在網頁中。</li>
          <li><b>AI</b>：Groq 提供的開源模型，搭配提示詞規範「繁體中文、白話、只根據提供的數據回答、不保證漲跌」。</li>
        </ul>

        <h3 style="margin-top:18px">📐 指標怎麼算</h3>
        <ul>
          <li>均線 MA5／MA20／MA60：近 5／20／60 日收盤價平均。</li>
          <li>布林通道：20 日均線 ± 2 倍標準差。</li>
          <li>KD(9,3,3)：RSV＝(收盤−9日最低)/(9日最高−9日最低)×100；K＝⅔前K＋⅓RSV；D＝⅔前D＋⅓K。</li>
          <li>MACD(12,26,9)：DIF＝EMA12−EMA26；訊號線＝DIF 的 9 日 EMA；柱狀體＝DIF−訊號線。</li>
          <li>RSI(14)：Wilder 平滑法計算 14 日平均漲幅／平均跌幅。</li>
        </ul>

        <h3 style="margin-top:18px">⚠ 限制與未來改進</h3>
        <ul>
          <li>股價為盤後／延遲資料，非即時報價；部分來源（Yahoo、PTT）為非官方管道，可能因改版暫時失效，系統已設計備援與示範資料。</li>
          <li>技術指標只反映過去的價格與成交量，無法預測突發消息；未來可加入基本面（營收、本益比）、法人買賣超與「回測」功能驗證篩選規則的有效性。</li>
          <li>免費 AI 有使用次數限制，系統會快取相同問題的答案供所有使用者共用。</li>
        </ul>
        <p class="alert" style="margin-top:14px">本網站為課程作業，所有內容僅供學習參考，不構成投資建議。</p>
      </div>`;
  }

  // ---------- 啟動 ----------
  if (DEMO) {
    const bar = $("#demoBar");
    bar.hidden = false;
    bar.innerHTML = "🧪 <b>示範模式</b>：目前顯示的是隨機產生的示範資料（還沒連接後端）。照著上線教學設定好 <code>config.js</code> 後就會變成真實資料。";
  }
  Auth.load();
  renderUser();
  if (!Auth.user) showLogin();
  route();
})();
