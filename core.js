// =============================================================
// 核心：設定、登入、資料庫、API、技術指標、圖表解說、示範資料
// =============================================================
(function () {
  const CFG = window.APP_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const DEMO = params.has("demo") || !CFG.SUPABASE_URL || /你的|YOUR|xxxx/i.test(CFG.SUPABASE_URL + CFG.SUPABASE_KEY);
  const BASE = (CFG.SUPABASE_URL || "").replace(/\/$/, "");
  const KEY = CFG.SUPABASE_KEY || "";

  // ---------- 小工具 ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n, d = 2) => n == null || !isFinite(n) ? "—" : Number(n).toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtPct = (n) => n == null || !isFinite(n) ? "—" : (n > 0 ? "+" : "") + Number(n).toFixed(2) + "%";
  const cls = (n) => n > 0 ? "up" : n < 0 ? "down" : "flat";
  const fmtVol = (v) => v == null ? "—" : v >= 1e8 ? (v / 1e8).toFixed(2) + " 億" : v >= 1e4 ? (v / 1e4).toFixed(0) + " 萬" : String(Math.round(v));
  const timeAgo = (iso) => {
    if (!iso) return "";
    const m = (Date.now() - new Date(iso).getTime()) / 60000;
    if (m < 1) return "剛剛";
    if (m < 60) return Math.floor(m) + " 分鐘前";
    if (m < 1440) return Math.floor(m / 60) + " 小時前";
    return Math.floor(m / 1440) + " 天前";
  };
  // 簡易 Markdown → HTML（AI 回覆用）
  function md(text) {
    const lines = esc(text).split("\n");
    let html = "", inList = false;
    for (let l of lines) {
      l = l.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
      const li = l.match(/^\s*(?:[-*•]|\d+[.)、])\s+(.*)/);
      if (li) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${li[1]}</li>`; continue; }
      if (inList) { html += "</ul>"; inList = false; }
      const h = l.match(/^#{1,4}\s+(.*)/);
      if (h) html += `<h4>${h[1]}</h4>`;
      else if (l.trim()) html += `<p>${l}</p>`;
    }
    if (inList) html += "</ul>";
    return html;
  }

  // ---------- 登入（直接呼叫 Supabase Auth REST API） ----------
  const SKEY = "sh_session";
  const Auth = {
    session: null,
    load() {
      try { this.session = JSON.parse(localStorage.getItem(SKEY) || "null"); } catch { this.session = null; }
      return this.session;
    },
    save(s) {
      if (s && s.access_token) {
        if (!s.expires_at && s.expires_in) s.expires_at = Math.floor(Date.now() / 1000) + s.expires_in;
        this.session = s;
        localStorage.setItem(SKEY, JSON.stringify(s));
      } else { this.session = null; localStorage.removeItem(SKEY); }
    },
    get user() { return this.session?.user || null; },
    get isGuest() { return !!this.user && (this.user.is_anonymous || !this.user.email); },
    async _post(path, body, token) {
      const r = await fetch(BASE + "/auth/v1" + path, {
        method: path === "/user" ? "PUT" : "POST",
        headers: { apikey: KEY, "Content-Type": "application/json", Authorization: "Bearer " + (token || KEY) },
        body: JSON.stringify(body || {}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(authMsg(j.msg || j.error_description || j.message || j.error || ("HTTP " + r.status)));
      return j;
    },
    async guest() {
      if (DEMO) { this.save({ access_token: "demo", expires_at: 9e9, user: { id: "demo", is_anonymous: true } }); return; }
      this.save(await this._post("/signup", { data: {} }));
    },
    async signUp(email, password) {
      if (DEMO) throw new Error("示範模式不能註冊，請按「訪客進入」");
      const j = await this._post("/signup", { email, password });
      if (j.access_token) { this.save(j); return "ok"; }
      return "confirm";
    },
    async signIn(email, password) {
      if (DEMO) throw new Error("示範模式不能登入，請按「訪客進入」");
      this.save(await this._post("/token?grant_type=password", { email, password }));
    },
    async upgrade(email, password) {
      // 訪客升級為正式帳號（自選股會保留）
      const token = await this.token();
      const u = await this._post("/user", { email, password }, token);
      if (u && u.id) { this.session.user = u; this.save(this.session); }
      return u;
    },
    async token() {
      const s = this.session;
      if (!s) return null;
      if (DEMO) return "demo";
      if (s.expires_at && s.expires_at - Date.now() / 1000 < 90 && s.refresh_token) {
        try { this.save(await this._post("/token?grant_type=refresh_token", { refresh_token: s.refresh_token })); }
        catch { this.save(null); return null; }
      }
      return this.session?.access_token || null;
    },
    async signOut() {
      const t = this.session?.access_token;
      if (t && !DEMO) fetch(BASE + "/auth/v1/logout", { method: "POST", headers: { apikey: KEY, Authorization: "Bearer " + t } }).catch(() => {});
      this.save(null);
    },
  };
  function authMsg(m) {
    const map = [
      [/Invalid login credentials/i, "Email 或密碼錯誤"],
      [/already registered|already been registered|already exists/i, "這個 Email 已經註冊過了，請直接登入"],
      [/Password should be at least/i, "密碼至少要 6 個字元"],
      [/Anonymous sign-ins are disabled/i, "後台還沒開啟「匿名登入」，請照教學第 3 步設定"],
      [/Email not confirmed/i, "Email 還沒驗證，請到信箱點確認信"],
      [/Unable to validate email|invalid format/i, "Email 格式不正確"],
      [/rate limit|too many/i, "操作太頻繁，請稍後再試"],
      [/Signups not allowed/i, "後台目前關閉註冊"],
    ];
    for (const [re, zh] of map) if (re.test(m)) return zh;
    return m;
  }

  // ---------- 自選股資料庫 ----------
  const LKEY = "sh_demo_watchlist";
  const DB = {
    async _req(method, query, body) {
      const token = await Auth.token();
      const r = await fetch(BASE + "/rest/v1/watchlist" + (query || ""), {
        method,
        headers: {
          apikey: KEY, Authorization: "Bearer " + token, "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        const m = j?.message || "HTTP " + r.status;
        if (/duplicate key/i.test(m)) throw new Error("這檔已經在自選股裡了");
        if (/relation .* does not exist|Could not find the table/i.test(m)) throw new Error("資料表還沒建立，請照教學第 2 步執行 schema.sql");
        throw new Error(m);
      }
      return j;
    },
    _local() { try { return JSON.parse(localStorage.getItem(LKEY) || "null"); } catch { return null; } },
    _saveLocal(a) { localStorage.setItem(LKEY, JSON.stringify(a)); },
    async list() {
      if (DEMO) {
        let a = this._local();
        if (!a) { a = Demo.defaultWatchlist(); this._saveLocal(a); }
        return a;
      }
      return await this._req("GET", "?select=*&order=created_at.asc");
    },
    async add(row) {
      if (DEMO) {
        const a = await this.list();
        if (a.some((x) => x.market === row.market && x.symbol === row.symbol)) throw new Error("這檔已經在自選股裡了");
        a.push({ id: Date.now(), stop_loss_pct: 8, take_profit_pct: 20, ...row, created_at: new Date().toISOString() });
        this._saveLocal(a); return;
      }
      await this._req("POST", "", row);
    },
    async update(id, patch) {
      if (DEMO) { const a = (await this.list()).map((x) => x.id === id ? { ...x, ...patch } : x); this._saveLocal(a); return; }
      await this._req("PATCH", "?id=eq." + id, patch);
    },
    async remove(id) {
      if (DEMO) { this._saveLocal((await this.list()).filter((x) => x.id !== id)); return; }
      await this._req("DELETE", "?id=eq." + id);
    },
  };

  // ---------- 後端 API ----------
  const memo = new Map();
  async function api(action, p = {}, opt = {}) {
    const key = action + JSON.stringify(p);
    const ttl = opt.ttl ?? (action === "ai" ? 0 : 5 * 60e3);
    const hit = memo.get(key);
    if (ttl && hit && Date.now() - hit.t < ttl) return hit.v;
    let v;
    if (DEMO) {
      await new Promise((r) => setTimeout(r, 250 + Math.random() * 300));
      v = Demo.handle(action, p);
      v = { data: v, demo: true };
    } else {
      try {
        const token = await Auth.token();
        const r = await fetch(`${BASE}/functions/v1/${CFG.FUNCTION_NAME || "stock-api"}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: KEY, Authorization: "Bearer " + (token || KEY) },
          body: JSON.stringify({ action, ...p }),
          signal: AbortSignal.timeout(action === "screen" ? 120000 : 60000),
        });
        const j = await r.json().catch(() => null);
        if (!j) throw new Error(`後端沒有回應（HTTP ${r.status}）。請確認 Edge Function 已部署，且關閉了「Verify JWT」`);
        if (!j.ok) throw new Error(j.error || "未知錯誤");
        v = { data: j.data, demo: false };
      } catch (e) {
        if (opt.noFallback || action === "ai") throw e;
        // 真實資料抓不到 → 改用示範資料，讓畫面不會開天窗
        console.warn("[api]", action, e);
        v = { data: Demo.handle(action, p), demo: true, error: e.message };
      }
    }
    if (ttl && !v.error) memo.set(key, { t: Date.now(), v });
    return v;
  }

  // ---------- 技術指標 ----------
  const IND = {
    sma(v, n) { const o = []; let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; o.push(i >= n - 1 ? s / n : null); } return o; },
    ema(v, n) { const o = [], k = 2 / (n + 1); v.forEach((x, i) => o.push(i === 0 ? x : x * k + o[i - 1] * (1 - k))); return o; },
    rsi(v, n = 14) {
      const o = [null]; let g = 0, l = 0;
      for (let i = 1; i < v.length; i++) {
        const ch = v[i] - v[i - 1], up = Math.max(ch, 0), dn = Math.max(-ch, 0);
        if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; o.push(l === 0 ? 100 : 100 - 100 / (1 + g / l)); } else o.push(null); }
        else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o.push(l === 0 ? 100 : 100 - 100 / (1 + g / l)); }
      }
      return o;
    },
    kd(c, n = 9) {
      const K = [], D = []; let k = 50, d = 50;
      for (let i = 0; i < c.length; i++) {
        if (i < n - 1) { K.push(null); D.push(null); continue; }
        let hh = -Infinity, ll = Infinity;
        for (let j = i - n + 1; j <= i; j++) { hh = Math.max(hh, c[j].high); ll = Math.min(ll, c[j].low); }
        const rsv = hh === ll ? 50 : (c[i].close - ll) / (hh - ll) * 100;
        k = k * 2 / 3 + rsv / 3; d = d * 2 / 3 + k / 3; K.push(k); D.push(d);
      }
      return { K, D };
    },
    macd(v) {
      const e12 = this.ema(v, 12), e26 = this.ema(v, 26);
      const dif = v.map((_, i) => e12[i] - e26[i]), sig = this.ema(dif, 9);
      return { dif, sig, hist: dif.map((x, i) => x - sig[i]) };
    },
    boll(v, n = 20, m = 2) {
      const mid = this.sma(v, n), up = [], lo = [];
      for (let i = 0; i < v.length; i++) {
        if (mid[i] == null) { up.push(null); lo.push(null); continue; }
        let s = 0; for (let j = i - n + 1; j <= i; j++) s += (v[j] - mid[i]) ** 2;
        const sd = Math.sqrt(s / n); up.push(mid[i] + m * sd); lo.push(mid[i] - m * sd);
      }
      return { mid, up, lo };
    },
    all(c) {
      const close = c.map((x) => x.close), vol = c.map((x) => x.volume);
      const b = this.boll(close), k = this.kd(c), m = this.macd(close);
      return {
        ma5: this.sma(close, 5), ma20: this.sma(close, 20), ma60: this.sma(close, 60),
        bbUp: b.up, bbMid: b.mid, bbLo: b.lo, K: k.K, D: k.D,
        dif: m.dif, sig: m.sig, hist: m.hist, rsi: this.rsi(close), volMa: this.sma(vol, 20),
      };
    },
  };

  // ---------- 圖表解說（規則式，免費、即時） ----------
  const LEARN = {
    ma: "均線＝過去 N 天收盤價的平均。5日線看短線（一週）、20日線看中線（一個月，俗稱「月線」）、60日線看長線（一季，俗稱「季線」）。股價在均線上面，代表最近買的人大多賺錢，趨勢偏強。",
    bb: "布林通道＝以 20 日均線為中心，上下各加減 2 個標準差畫出的「通道」。股價大約 95% 的時間會待在通道裡。碰到上軌代表短線漲多偏熱，碰到下軌代表跌深；通道變窄代表股價在盤整、可能快要出現大波動。",
    vol: "成交量＝當天買賣成交的股數。價格上漲時量也放大，代表很多人認同這個價格（有人氣）；如果漲但量縮，代表追的人不多，要小心。",
    kd: "KD 指標＝看「今天收盤價位在最近 9 天的高低區間的哪裡」。數值 0～100：80 以上是高檔（偏熱）、20 以下是低檔（偏冷）。K 線往上穿過 D 線叫「黃金交叉」，往下穿過叫「死亡交叉」。",
    macd: "MACD＝用快慢兩條平均線的差距看「趨勢動能」。DIF 在訊號線上面、柱狀體是紅的，代表上漲動能在增強；柱狀體由綠翻紅常被當成轉強的訊號。它反應比較慢，適合看中期趨勢。",
    rsi: "RSI 相對強弱指標＝最近 14 天「漲的力道」佔「總波動」的比例，0～100。70 以上代表漲太多、可能過熱，30 以下代表跌太多、可能超賣。50 上下代表多空力量差不多。",
  };

  function crossAt(a, b, i) {
    return a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null
      ? (a[i] > b[i] && a[i - 1] <= b[i - 1] ? 1 : a[i] < b[i] && a[i - 1] >= b[i - 1] ? -1 : 0) : 0;
  }

  function explain(c, ind, show) {
    const n = c.length, i = n - 1, last = c[i];
    const markers = [], notes = [];
    const R = window.CHART_COLORS || { UP: "#e5484d", DOWN: "#1f9d61" };
    const from = Math.max(1, n - 90); // 只標最近約 4 個月，避免圖太亂
    // 圖上標記
    for (let j = from; j < n; j++) {
      if (show.ma) {
        const x = crossAt(ind.ma5, ind.ma20, j);
        if (x === 1) markers.push({ i: j, pos: "below", color: R.UP, text: "均線金叉" });
        if (x === -1) markers.push({ i: j, pos: "above", color: R.DOWN, text: "均線死叉" });
      }
      if (show.kd) {
        const x = crossAt(ind.K, ind.D, j);
        if (x === 1 && ind.K[j] < 20) markers.push({ i: j, pos: "below", color: R.UP, text: "KD低檔金叉" });
        if (x === -1 && ind.K[j] > 80) markers.push({ i: j, pos: "above", color: R.DOWN, text: "KD高檔死叉" });
      }
      if (show.bb && ind.bbUp[j] != null) {
        if (c[j].close > ind.bbUp[j] && !(c[j - 1].close > ind.bbUp[j - 1])) markers.push({ i: j, pos: "above", color: "#6366f1", text: "突破上軌" });
        if (c[j].close < ind.bbLo[j] && !(c[j - 1].close < ind.bbLo[j - 1])) markers.push({ i: j, pos: "below", color: "#6366f1", text: "跌破下軌" });
      }
      if (show.vol && ind.volMa[j] && c[j].volume > ind.volMa[j] * 2.2) {
        markers.push({ i: j, pos: c[j].close >= c[j].open ? "below" : "above", color: "#64748b", text: "爆量" });
      }
    }
    // 避免標記擠在一起：同一根 K 棒同一側只留一個
    const seen = new Set();
    const mk = markers.filter((m) => { const k = m.i + m.pos; if (seen.has(k)) return false; seen.add(k); return true; });

    const chg = (last.close / c[i - 1].close - 1) * 100;
    // 均線
    if (show.ma) {
      const above = [["5日線", ind.ma5[i]], ["月線", ind.ma20[i]], ["季線", ind.ma60[i]]].filter(([, v]) => v != null);
      const ups = above.filter(([, v]) => last.close > v).map(([k]) => k);
      const downs = above.filter(([, v]) => last.close <= v).map(([k]) => k);
      let level = "info", text;
      const bull = ind.ma60[i] != null && ind.ma5[i] > ind.ma20[i] && ind.ma20[i] > ind.ma60[i];
      const bear = ind.ma60[i] != null && ind.ma5[i] < ind.ma20[i] && ind.ma20[i] < ind.ma60[i];
      if (bull) { level = "good"; text = "三條均線「多頭排列」（短線 > 月線 > 季線），代表短、中、長期買進的人都在賺錢，趨勢向上。"; }
      else if (bear) { level = "warn"; text = "三條均線「空頭排列」（短線 < 月線 < 季線），代表趨勢向下，買進的人多半套牢，先別急著接。"; }
      else text = "均線糾結、方向不一致，代表股價在整理，還沒走出明確方向。";
      if (ups.length) text += ` 目前股價在 ${ups.join("、")} 之上`;
      if (downs.length) text += `${ups.length ? "，但" : " 目前股價"}在 ${downs.join("、")} 之下`;
      text += "。";
      for (let j = i; j > i - 5; j--) {
        const x = crossAt(ind.ma5, ind.ma20, j);
        if (x === 1) { text += ` ${i - j === 0 ? "今天" : (i - j) + " 天前"} 5日線剛向上穿過月線（黃金交叉），是短線轉強的訊號。`; break; }
        if (x === -1) { text += ` ${i - j === 0 ? "今天" : (i - j) + " 天前"} 5日線跌破月線（死亡交叉），短線轉弱。`; level = "warn"; break; }
      }
      notes.push({ key: "ma", title: "均線（趨勢）", level, text });
    }
    // 布林
    if (show.bb && ind.bbUp[i] != null) {
      const up = ind.bbUp[i], lo = ind.bbLo[i], mid = ind.bbMid[i];
      const pb = (last.close - lo) / (up - lo);
      const width = (up - lo) / mid;
      const widths = [];
      for (let j = Math.max(19, i - 120); j <= i; j++) if (ind.bbUp[j] != null) widths.push((ind.bbUp[j] - ind.bbLo[j]) / ind.bbMid[j]);
      const minW = Math.min(...widths), maxW = Math.max(...widths);
      let level = "info", text;
      if (pb > 1) { level = "warn"; text = `股價收在布林「上軌」之外（上軌 ${fmt(up)}），代表短線漲得很急、偏熱，常會回到通道內休息。如果是剛起漲且量大，則可能是強勢突破。`; }
      else if (pb > 0.8) { text = `股價靠近布林上軌（${fmt(up)}），屬於通道上緣的強勢區，但再往上空間有限，追高要設好停損。`; }
      else if (pb < 0) { level = "warn"; text = `股價跌破布林「下軌」（${fmt(lo)}），代表短線跌深，可能出現跌深反彈，但也可能是弱勢加速，最好等站回下軌再說。`; }
      else if (pb < 0.2) { text = `股價靠近布林下軌（${fmt(lo)}），屬於通道下緣的偏弱區，下軌常常是短線的支撐。`; }
      else if (pb >= 0.5) { level = "good"; text = `股價在布林中軌（${fmt(mid)}）之上，屬於通道內偏強的位置。`; }
      else { text = `股價在布林中軌（${fmt(mid)}）之下，屬於通道內偏弱的位置，中軌是上方壓力。`; }
      if (width <= minW + (maxW - minW) * 0.15) text += " 另外，通道寬度接近近半年最窄，代表股價在「蓄力盤整」，接下來可能出現比較大的波動（方向未定）。";
      else if (width >= maxW - (maxW - minW) * 0.15) text += " 通道目前很寬，代表最近波動很大。";
      notes.push({ key: "bb", title: "布林通道（位置與波動）", level, text });
    }
    // 成交量
    if (show.vol && ind.volMa[i]) {
      const r = last.volume / ind.volMa[i];
      let level = "info", text = `今天成交量約是 20 日平均的 ${r.toFixed(1)} 倍。`;
      if (r > 1.5 && chg > 0) { level = "good"; text += "價漲量增，代表買盤積極、有人氣。"; }
      else if (r > 1.5 && chg < 0) { level = "warn"; text += "價跌量增，代表有人急著賣，要小心。"; }
      else if (r < 0.6) text += "量縮，代表市場觀望、交易冷清。";
      else text += "量能正常。";
      notes.push({ key: "vol", title: "成交量（人氣）", level, text });
    }
    // KD
    if (show.kd && ind.K[i] != null) {
      const K = ind.K[i], D = ind.D[i];
      let level = "info", text = `K 值 ${K.toFixed(0)}、D 值 ${D.toFixed(0)}。`;
      if (K > 80) { level = "warn"; text += "在 80 以上的高檔區，代表短線漲多偏熱。不過強勢股可能會在高檔「鈍化」一陣子，不一定馬上跌。"; }
      else if (K < 20) { text += "在 20 以下的低檔區，代表短線跌深、偏冷，留意是否出現黃金交叉。"; }
      else text += K > D ? "K 在 D 之上，短線偏多。" : "K 在 D 之下，短線偏弱。";
      for (let j = i; j > i - 4; j--) {
        const x = crossAt(ind.K, ind.D, j);
        if (x === 1) { text += ` 最近出現「黃金交叉」${ind.K[j] < 30 ? "，而且發生在低檔，參考價值較高" : ""}。`; if (ind.K[j] < 50) level = "good"; break; }
        if (x === -1) { text += ` 最近出現「死亡交叉」${ind.K[j] > 70 ? "，而且發生在高檔，要留意回檔" : ""}。`; level = "warn"; break; }
      }
      notes.push({ key: "kd", title: "KD（短線強弱）", level, text });
    }
    // MACD
    if (show.macd) {
      const h = ind.hist[i], hp = ind.hist[i - 1], dif = ind.dif[i];
      let level = "info", text = "";
      if (h > 0 && hp <= 0) { level = "good"; text = "MACD 柱狀體剛由綠翻紅，代表上漲動能開始轉強。"; }
      else if (h < 0 && hp >= 0) { level = "warn"; text = "MACD 柱狀體剛由紅翻綠，代表動能轉弱。"; }
      else if (h > 0) text = h > hp ? "柱狀體為紅且變長，上漲動能持續增強。" : "柱狀體為紅但開始縮短，上漲動能在減弱，留意是否轉弱。";
      else text = h < hp ? "柱狀體為綠且變長，下跌動能還在增強。" : "柱狀體為綠但開始縮短，下跌力道在減弱，可能快止跌。";
      text += dif > 0 ? " DIF 在 0 軸之上，中期趨勢偏多。" : " DIF 在 0 軸之下，中期趨勢偏空。";
      if (level === "info" && h > 0 && dif > 0) level = "good";
      if (level === "info" && h < 0 && dif < 0) level = "warn";
      notes.push({ key: "macd", title: "MACD（中期動能）", level, text });
    }
    // RSI
    if (show.rsi && ind.rsi[i] != null) {
      const r = ind.rsi[i];
      let level = "info", text = `RSI 為 ${r.toFixed(0)}。`;
      if (r > 80) { level = "warn"; text += "非常過熱，短線隨時可能回檔，不建議追高。"; }
      else if (r > 70) { level = "warn"; text += "進入過熱區（70 以上），漲勢強但要小心追高。"; }
      else if (r >= 50) { level = "good"; text += "在 50～70 之間，買方力道較強、但還沒過熱，是相對健康的強勢。"; }
      else if (r >= 30) text += "在 30～50 之間，賣方稍微佔上風，走勢偏弱。";
      else text += "低於 30 的超賣區，跌得很兇，可能出現反彈，但不代表已經見底。";
      notes.push({ key: "rsi", title: "RSI（過熱或超賣）", level, text });
    }
    return { markers: mk, notes, summary: overall(c, ind) };
  }

  // 綜合評分（和後端篩選同一套邏輯）
  function overall(c, ind) {
    const i = c.length - 1, last = c[i];
    let score = 0;
    const good = [], warn = [];
    const dayChg = (last.close / c[i - 1].close - 1) * 100;
    if (dayChg <= -7) { score -= 4; warn.push(`今天重挫 ${dayChg.toFixed(1)}%`); }
    else if (dayChg <= -4) { score -= 2; warn.push(`今天大跌 ${dayChg.toFixed(1)}%`); }
    if (ind.ma20[i] != null && last.close > ind.ma20[i]) { score++; good.push("站上月線"); } else warn.push("在月線之下");
    if (ind.ma60[i] != null && ind.ma5[i] > ind.ma20[i] && ind.ma20[i] > ind.ma60[i]) { score++; good.push("均線多頭排列"); }
    if ([0, 1, 2].some((k) => crossAt(ind.ma5, ind.ma20, i - k) === 1)) { score += 2; good.push("均線剛黃金交叉"); }
    if (ind.volMa[i] && last.volume > 1.5 * ind.volMa[i] && last.close > c[i - 1].close) { score++; good.push("帶量上漲"); }
    const r = ind.rsi[i];
    if (r >= 50 && r <= 70) { score++; good.push("RSI 健康偏強"); } else if (r > 80) { score -= 2; warn.push("RSI 過熱"); } else if (r < 30) warn.push("RSI 超賣");
    if ([0, 1, 2].some((k) => crossAt(ind.K, ind.D, i - k) === 1)) { score += ind.K[i] < 50 ? 2 : 1; good.push("KD 黃金交叉"); }
    if (ind.K[i] > 80) { score--; warn.push("KD 高檔"); }
    if (ind.hist[i] > 0 && ind.hist.slice(i - 3, i).some((h) => h <= 0)) { score++; good.push("MACD 翻紅"); } else if (ind.hist[i] > 0) score += 0.5;
    if (ind.bbUp[i] != null && last.close > ind.bbUp[i]) { score--; warn.push("突破布林上軌偏熱"); }
    let label, level;
    if (score >= 4) { label = "偏多（技術面強）"; level = "good"; }
    else if (score >= 2) { label = "中性偏多"; level = "good"; }
    else if (score >= 0) { label = "中性觀望"; level = "info"; }
    else { label = "偏空（技術面弱）"; level = "warn"; }
    return { score: Math.round(score * 10) / 10, label, level, good, warn };
  }

  // 持股的賣出提醒
  function holdingAdvice(row, c, ind) {
    const i = c.length - 1, price = c[i].close;
    const tips = [];
    let status = { text: "續抱觀察", level: "info" };
    if (row.cost) {
      const pl = (price / row.cost - 1) * 100;
      const sl = row.stop_loss_pct ?? 8, tp = row.take_profit_pct ?? 20;
      if (pl <= -sl) { status = { text: "觸及停損，考慮賣出", level: "bad" }; tips.push(`已虧損 ${Math.abs(pl).toFixed(1)}%，超過你設定的停損 ${sl}%。停損是為了保護本金，避免小虧變大虧。`); }
      else if (pl >= tp) { status = { text: "達到停利，可分批獲利", level: "good" }; tips.push(`已獲利 ${pl.toFixed(1)}%，達到你設定的停利 ${tp}%。可以考慮先賣一部分，把獲利放進口袋。`); }
      else if (pl <= -sl * 0.7) tips.push(`虧損 ${Math.abs(pl).toFixed(1)}%，接近停損線（-${sl}%），要留意。`);
    }
    if (ind.ma20[i] != null && price < ind.ma20[i] && ind.ma5[i] < ind.ma20[i]) {
      tips.push("股價跌破月線而且 5 日線也在月線之下，中短期趨勢轉弱。");
      if (status.level === "info") status = { text: "趨勢轉弱，留意", level: "warn" };
    }
    if ([0, 1, 2].some((k) => crossAt(ind.K, ind.D, i - k) === -1) && ind.K[i] > 65) {
      tips.push("KD 在高檔死亡交叉，短線可能回檔。");
      if (status.level === "info") status = { text: "短線過熱，留意", level: "warn" };
    }
    if (ind.rsi[i] > 80) { tips.push("RSI 超過 80，短線過熱。"); if (status.level === "info") status = { text: "短線過熱，留意", level: "warn" }; }
    if (ind.bbLo[i] != null && price < ind.bbLo[i]) tips.push("跌破布林下軌，弱勢明顯。");
    if (!tips.length) tips.push("技術面沒有明顯的賣出訊號，可以繼續觀察。");
    return { status, tips, price };
  }

  // =============================================================
  // 示範資料（還沒設定後端、或外部資料暫時抓不到時使用）
  // =============================================================
  const TW_NAMES = {
    "2330": "台積電", "2317": "鴻海", "2454": "聯發科", "2308": "台達電", "2382": "廣達", "2881": "富邦金", "2882": "國泰金",
    "2303": "聯電", "3711": "日月光投控", "2412": "中華電", "2891": "中信金", "1301": "台塑", "2002": "中鋼", "3008": "大立光",
    "2603": "長榮", "2609": "陽明", "3231": "緯創", "2357": "華碩", "6669": "緯穎", "2345": "智邦", "3034": "聯詠", "2379": "瑞昱",
    "1216": "統一", "2886": "兆豐金", "2884": "玉山金", "3661": "世芯-KY", "2376": "技嘉", "2356": "英業達", "3037": "欣興", "2327": "國巨",
  };
  const US_NAMES = { AAPL: "蘋果", MSFT: "微軟", NVDA: "輝達", AMZN: "亞馬遜", GOOGL: "Google", META: "Meta", TSLA: "特斯拉", AVGO: "博通", AMD: "超微", TSM: "台積電ADR", NFLX: "Netflix", COST: "好市多", JPM: "摩根大通", PLTR: "Palantir", INTC: "英特爾", MU: "美光" };
  const BASE_PRICE = { "2330": 1050, "2317": 210, "2454": 1300, "2308": 380, "2382": 290, "2881": 85, "2882": 62, "2303": 48, "2412": 128, "2603": 190, AAPL: 230, MSFT: 420, NVDA: 140, AMZN: 200, GOOGL: 170, META: 560, TSLA: 260, AVGO: 170, AMD: 150, TSM: 190, "^TWII": 22500, "^TWOII": 250, "^GSPC": 5900, "^IXIC": 19000, "^DJI": 43000, "^SOX": 5000 };

  function rng(seed) {
    let h = 2166136261;
    for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function genCandles(symbol, days = 260) {
    const r = rng(symbol);
    let p = BASE_PRICE[symbol] || (20 + r() * 300);
    const out = [];
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const dates = [];
    while (dates.length < days) { if (d.getDay() !== 0 && d.getDay() !== 6) dates.unshift(d.toISOString().slice(0, 10)); d.setDate(d.getDate() - 1); }
    p = p * (0.75 + r() * 0.3);
    const drift = (r() - 0.45) * 0.003;
    let regime = 0;
    for (const time of dates) {
      if (r() < 0.04) regime = (r() - 0.5) * 0.012;
      const ch = drift + regime + (r() - 0.5) * 0.04;
      const open = p * (1 + (r() - 0.5) * 0.01);
      const close = Math.max(1, open * (1 + ch));
      const high = Math.max(open, close) * (1 + r() * 0.012);
      const low = Math.min(open, close) * (1 - r() * 0.012);
      const vol = Math.round((5e6 + r() * 2e7) * (1 + Math.abs(ch) * 25));
      const dec = p > 100 ? 1 : 2;
      out.push({ time, open: +open.toFixed(dec), high: +high.toFixed(dec), low: +low.toFixed(dec), close: +close.toFixed(dec), volume: vol });
      p = close;
    }
    return out;
  }

  const Demo = {
    defaultWatchlist() {
      return [
        { id: 1, market: "TW", symbol: "2330", name: "台積電", cost: 900, shares: 1000, stop_loss_pct: 8, take_profit_pct: 20 },
        { id: 2, market: "TW", symbol: "2317", name: "鴻海", cost: 230, shares: 2000, stop_loss_pct: 8, take_profit_pct: 20 },
        { id: 3, market: "US", symbol: "NVDA", name: "輝達", cost: null, shares: null, stop_loss_pct: 8, take_profit_pct: 20 },
      ];
    },
    handle(action, p) {
      const market = (p.market || "TW").toUpperCase();
      switch (action) {
        case "indices": {
          return [["^TWII", "台股加權指數"], ["^TWOII", "櫃買指數"], ["^GSPC", "美國標普500"], ["^IXIC", "那斯達克"], ["^DJI", "道瓊工業"], ["^SOX", "費城半導體"]].map(([s, name]) => {
            const c = genCandles(s, 40), l = c.at(-1), pv = c.at(-2);
            return { symbol: s, name, close: l.close, change: l.close - pv.close, changePct: (l.close / pv.close - 1) * 100, date: l.time, spark: c.slice(-20).map((x) => x.close) };
          });
        }
        case "history": {
          const sym = String(p.symbol).toUpperCase();
          const names = market === "TW" ? TW_NAMES : US_NAMES;
          return { market, symbol: sym, name: names[sym] || sym, currency: market === "TW" ? "TWD" : "USD", source: "示範資料（隨機產生）", candles: genCandles(sym, 260) };
        }
        case "movers": {
          const names = market === "TW" ? TW_NAMES : US_NAMES;
          const list = Object.entries(names).map(([s, n]) => {
            const c = genCandles(s, 3), l = c.at(-1), pv = c.at(-2);
            return { symbol: s, name: n, close: l.close, change: l.close - pv.close, changePct: (l.close / pv.close - 1) * 100, volume: l.volume };
          }).sort((a, b) => b.changePct - a.changePct);
          return { date: new Date().toISOString().slice(0, 10), source: "示範資料", gainers: list.slice(0, 10), losers: list.slice(-10).reverse(), active: [...list].sort((a, b) => b.volume - a.volume).slice(0, 10) };
        }
        case "screen": {
          const names = market === "TW" ? TW_NAMES : US_NAMES;
          const list = Object.entries(names).map(([s, n]) => {
            const c = genCandles(s, 260), ind = IND.all(c), o = overall(c, ind), l = c.at(-1);
            return { symbol: s, name: n, score: o.score, good: o.good, warn: o.warn, close: l.close, changePct: (l.close / c.at(-2).close - 1) * 100, rsi: ind.rsi.at(-1), k: ind.K.at(-1), d: ind.D.at(-1), date: l.time };
          }).sort((a, b) => b.score - a.score);
          return { market, updatedAt: new Date().toISOString(), scanned: list.length, universeNote: "示範資料", picks: list.slice(0, 12), avoid: list.filter((x) => x.warn.length >= 2).slice(-5).reverse() };
        }
        case "news": {
          const now = Date.now();
          const mk = (title, source, h) => ({ title, url: "https://news.google.com/", source, time: new Date(now - h * 3600e3).toISOString() });
          if (p.type === "world") return {
            international: [
              { ...mk("[示範] Fed officials signal patience on further rate cuts", "Reuters", 1), summary: "Several Federal Reserve officials said they want more data before cutting rates again." },
              { ...mk("[示範] Chipmakers rally as AI demand outlook improves", "CNBC", 3), summary: "Semiconductor stocks rose after strong guidance from major AI suppliers." },
              { ...mk("[示範] Oil prices slip on rising inventories", "Bloomberg", 5), summary: "Crude futures fell after US inventories rose more than expected." },
            ],
            chinese: [mk("[示範] 美股四大指數漲跌互見 科技股撐盤", "經濟日報", 2), mk("[示範] 聯準會官員發言偏鷹 降息預期降溫", "鉅亨網", 4)],
          };
          if (p.type === "tw") return { chinese: [mk("[示範] 台股外資轉買 加權指數收紅", "工商時報", 1), mk("[示範] AI 伺服器族群走強 成交量放大", "自由財經", 3), mk("[示範] 航運股回檔 投信調節", "MoneyDJ", 6)] };
          return { chinese: [mk(`[示範] ${p.name || p.symbol} 法說會釋出樂觀展望`, "經濟日報", 5), mk(`[示範] ${p.name || p.symbol} 營收創新高`, "鉅亨網", 30)], international: [] };
        }
        case "ptt": {
          const t = ["[標的] 2330 台積電 多", "[新聞] 聯發科新晶片報價調升", "[請益] 鴻海還能上車嗎", "[心得] 存股三年的一點想法", "[標的] 2603 長榮 空", "[新聞] 外資連三買 台股量能回溫"];
          return {
            updatedAt: new Date().toISOString(), total: 80,
            hotPosts: t.map((title, i) => ({ title: "[示範] " + title, url: "https://www.ptt.cc/bbs/Stock/index.html", push: [100, 87, 56, 41, 33, 20][i], date: "", author: "demo" })),
            hotStocks: [["2330", 9, 210], ["2317", 6, 120], ["2454", 4, 95], ["2603", 3, 40], ["3231", 2, 22]].map(([s, m, pu]) => ({ symbol: s, name: TW_NAMES[s], mentions: m, push: pu, titles: [] })),
          };
        }
        case "search": {
          const q = String(p.q || "");
          return Object.entries(TW_NAMES).filter(([s, n]) => s.startsWith(q) || n.includes(q)).slice(0, 8).map(([s, n]) => ({ symbol: s, name: n, market: "TW" }));
        }
        case "ai":
          return { text: "（示範模式：設定好 Groq 金鑰後，這裡會由 AI 依照真實數據回答）\n\n" + demoAI(p), model: "demo" };
      }
      return null;
    },
  };
  function demoAI(p) {
    const ctx = p.context || {};
    if (ctx.notes) {
      return `**一句話結論：** ${ctx.stock?.name || "這檔股票"} 目前技術面「${ctx.summary?.label || "中性"}」。\n\n` +
        ctx.notes.map((n) => `- **${n.title}**：${n.text}`).join("\n") + "\n\n（以上為學習用的數據解讀，不是投資建議）";
    }
    return "這是示範回覆。正式上線後，AI 會用白話方式回答你的問題，例如解釋 KD、布林通道，或幫你看持股。\n\n（以上為學習用的數據解讀，不是投資建議）";
  }

  window.Core = { CFG, DEMO, esc, fmt, fmtPct, cls, fmtVol, timeAgo, md, Auth, DB, api, IND, explain, overall, holdingAdvice, LEARN };
})();
