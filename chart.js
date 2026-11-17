// =============================================================
// 自製 K 線圖引擎（純 Canvas，不需要任何外部套件）
// 支援：K 線、均線、布林通道、成交量、KD、MACD、RSI、圖上註記、
//       滑鼠滾輪縮放、拖曳平移、手機觸控、十字游標
// =============================================================
(function () {
  const UP = "#e5484d";     // 台灣習慣：紅漲
  const DOWN = "#1f9d61";   // 綠跌
  const C = {
    ma5: "#f59e0b", ma20: "#3b82f6", ma60: "#a855f7",
    bb: "#6366f1", k: "#f59e0b", d: "#3b82f6", dif: "#f59e0b", sig: "#3b82f6", rsi: "#a855f7",
  };

  class StockChart {
    constructor(el) {
      this.el = el;
      this.canvas = document.createElement("canvas");
      this.canvas.className = "sc-canvas";
      el.innerHTML = "";
      el.appendChild(this.canvas);
      this.ctx = this.canvas.getContext("2d");
      this.candles = [];
      this.ind = {};
      this.show = {};
      this.markers = [];
      this.count = 120;
      this.end = 0;
      this.hover = null;
      this._bind();
      this.ro = new ResizeObserver(() => this.draw());
      this.ro.observe(el);
    }

    setData(candles, ind, show, markers) {
      const keepView = this.candles.length === candles.length && this.candles.length > 0;
      this.candles = candles || [];
      this.ind = ind || {};
      this.show = show || {};
      this.markers = markers || [];
      if (!keepView) {
        this.end = this.candles.length - 1;
        this.count = Math.min(this.count || 120, this.candles.length);
      }
      this.draw();
    }

    setRange(n) {
      this.count = Math.max(20, Math.min(n, this.candles.length));
      this.end = this.candles.length - 1;
      this.draw();
    }

    // ---------- 互動 ----------
    _bind() {
      const cv = this.canvas;
      let drag = null;
      cv.addEventListener("wheel", (e) => {
        if (!this.candles.length) return;
        e.preventDefault();
        const f = e.deltaY > 0 ? 1.12 : 1 / 1.12;
        const rel = this._idxAt(e.offsetX);
        const newCount = Math.round(Math.max(20, Math.min(this.candles.length, this.count * f)));
        if (rel != null) {
          const frac = (this.end - rel) / this.count;
          this.end = Math.round(rel + frac * newCount);
        }
        this.count = newCount;
        this._clamp();
        this.draw();
      }, { passive: false });
      cv.addEventListener("pointerdown", (e) => {
        drag = { x: e.clientX, end: this.end, id: e.pointerId, moved: false };
        cv.setPointerCapture(e.pointerId);
      });
      cv.addEventListener("pointermove", (e) => {
        const r = cv.getBoundingClientRect();
        const ox = e.clientX - r.left, oy = e.clientY - r.top;
        if (drag && drag.id === e.pointerId) {
          const dx = e.clientX - drag.x;
          if (Math.abs(dx) > 3) drag.moved = true;
          const bw = this._plotW() / this.count;
          this.end = Math.round(drag.end - dx / bw);
          this._clamp();
        }
        this.hover = { x: ox, y: oy, i: this._idxAt(ox) };
        this.draw();
      });
      const up = (e) => {
        if (drag && !drag.moved && e.pointerType !== "mouse") {
          const r = cv.getBoundingClientRect();
          this.hover = { x: e.clientX - r.left, y: e.clientY - r.top, i: this._idxAt(e.clientX - r.left) };
          this.draw();
        }
        drag = null;
      };
      cv.addEventListener("pointerup", up);
      cv.addEventListener("pointercancel", up);
      cv.addEventListener("pointerleave", (e) => {
        if (e.pointerType === "mouse") { this.hover = null; this.draw(); }
      });
    }
    _clamp() {
      const n = this.candles.length;
      this.count = Math.max(Math.min(20, n), Math.min(this.count, n));
      this.end = Math.max(this.count - 1, Math.min(n - 1, this.end));
    }
    _plotW() { return Math.max(50, this.el.clientWidth - this.axisW - 8); }
    _start() { return this.end - this.count + 1; }
    _idxAt(x) {
      const bw = this._plotW() / this.count;
      const i = this._start() + Math.floor((x - 8) / bw);
      return i >= this._start() && i <= this.end ? i : null;
    }

    // ---------- 版面 ----------
    _panes() {
      const mobile = this.el.clientWidth < 600;
      const panes = [{ type: "main", h: mobile ? 260 : 330 }];
      if (this.show.vol) panes.push({ type: "vol", h: mobile ? 60 : 75 });
      if (this.show.kd) panes.push({ type: "kd", h: mobile ? 80 : 95 });
      if (this.show.macd) panes.push({ type: "macd", h: mobile ? 80 : 95 });
      if (this.show.rsi) panes.push({ type: "rsi", h: mobile ? 80 : 95 });
      let y = 0;
      for (const p of panes) { p.y = y; y += p.h; }
      return { panes, total: y + 24 };
    }

    draw() {
      const el = this.el, ctx = this.ctx;
      this.axisW = el.clientWidth < 600 ? 50 : 62;
      const W = el.clientWidth;
      if (!W) return;
      const { panes, total } = this._panes();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = W * dpr; this.canvas.height = total * dpr;
      this.canvas.style.width = W + "px"; this.canvas.style.height = total + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const dark = document.documentElement.dataset.theme === "dark";
      this.col = {
        grid: dark ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.06)",
        text: dark ? "#9aa4b2" : "#6b7280",
        strong: dark ? "#e5e7eb" : "#111827",
        bg: dark ? "#151a23" : "#ffffff",
        sep: dark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.1)",
        cross: dark ? "rgba(255,255,255,.35)" : "rgba(0,0,0,.35)",
      };
      ctx.clearRect(0, 0, W, total);
      if (!this.candles.length) {
        ctx.fillStyle = this.col.text; ctx.font = "14px system-ui";
        ctx.fillText("沒有資料", 20, 40);
        return;
      }
      this._clamp();
      const s = this._start(), e = this.end;
      const plotW = this._plotW();
      const bw = plotW / this.count;
      const x = (i) => 8 + (i - s + 0.5) * bw;
      this._x = x;
      const hi = this.hover && this.hover.i != null ? this.hover.i : e;

      panes.forEach((p, idx) => {
        if (idx > 0) {
          ctx.strokeStyle = this.col.sep; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(0, p.y + 0.5); ctx.lineTo(W, p.y + 0.5); ctx.stroke();
        }
        this["_" + p.type](p, s, e, x, bw, hi, W);
      });

      // X 軸日期
      const yAxis = total - 24;
      ctx.fillStyle = this.col.text; ctx.font = "11px system-ui"; ctx.textAlign = "center";
      const step = Math.max(1, Math.round(this.count / Math.max(3, Math.floor(plotW / 90))));
      for (let i = e; i >= s; i -= step) {
        const t = this.candles[i].time;
        ctx.fillText(t.slice(2, 4) + "/" + t.slice(5, 7) + "/" + t.slice(8, 10), x(i), yAxis + 15);
      }

      // 十字游標
      if (this.hover && this.hover.i != null) {
        const cx = x(this.hover.i);
        ctx.strokeStyle = this.col.cross; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, yAxis); ctx.stroke();
        if (this.hover.y < yAxis) {
          ctx.beginPath(); ctx.moveTo(0, this.hover.y); ctx.lineTo(W - this.axisW, this.hover.y); ctx.stroke();
          const pane = panes.find((p) => this.hover.y >= p.y && this.hover.y < p.y + p.h);
          if (pane && pane._inv) {
            const v = pane._inv(this.hover.y);
            ctx.setLineDash([]);
            ctx.fillStyle = this.col.strong;
            ctx.fillRect(W - this.axisW, this.hover.y - 9, this.axisW, 18);
            ctx.fillStyle = this.col.bg; ctx.textAlign = "left"; ctx.font = "11px system-ui";
            ctx.fillText(fmtAxis(v), W - this.axisW + 4, this.hover.y + 4);
          }
        }
        ctx.setLineDash([]);
        const t = this.candles[this.hover.i].time;
        ctx.fillStyle = this.col.strong;
        const tw = 74;
        ctx.fillRect(cx - tw / 2, yAxis + 2, tw, 18);
        ctx.fillStyle = this.col.bg; ctx.textAlign = "center"; ctx.font = "11px system-ui";
        ctx.fillText(t, cx, yAxis + 15);
      }
    }

    // ---------- 共用畫法 ----------
    _scale(p, min, max, padTop = 22, padBot = 6) {
      if (!(max > min)) { max = min + 1; min = min - 1; }
      const top = p.y + padTop, bot = p.y + p.h - padBot;
      const f = (v) => bot - (v - min) / (max - min) * (bot - top);
      p._inv = (yy) => min + (bot - yy) / (bot - top) * (max - min);
      return f;
    }
    _grid(p, f, min, max, W, fixed) {
      const ctx = this.ctx;
      const ticks = fixed || niceTicks(min, max, p.type === "main" ? 5 : 3);
      ctx.font = "11px system-ui"; ctx.textAlign = "left";
      for (const t of ticks) {
        const yy = Math.round(f(t)) + 0.5;
        if (yy < p.y + 14 || yy > p.y + p.h - 2) continue;
        ctx.strokeStyle = this.col.grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W - this.axisW, yy); ctx.stroke();
        ctx.fillStyle = this.col.text;
        ctx.fillText(fmtAxis(t), W - this.axisW + 4, yy + 4);
      }
    }
    _line(arr, s, e, x, f, color, width = 1.4, dash) {
      const ctx = this.ctx;
      ctx.strokeStyle = color; ctx.lineWidth = width;
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath();
      let started = false;
      for (let i = s; i <= e; i++) {
        const v = arr && arr[i];
        if (v == null || !isFinite(v)) { started = false; continue; }
        if (!started) { ctx.moveTo(x(i), f(v)); started = true; } else ctx.lineTo(x(i), f(v));
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    _legend(p, items) {
      const ctx = this.ctx;
      ctx.font = "12px system-ui"; ctx.textAlign = "left";
      let xx = 8;
      const yy = p.y + 15;
      for (const it of items) {
        if (it.v == null || (typeof it.v === "number" && !isFinite(it.v))) continue;
        const txt = it.label + (it.v === "" ? "" : " " + (typeof it.v === "number" ? fmtAxis(it.v) : it.v));
        ctx.fillStyle = it.color || this.col.text;
        ctx.fillText(txt, xx, yy);
        xx += ctx.measureText(txt).width + 12;
      }
    }

    // ---------- 主圖 ----------
    _main(p, s, e, x, bw, hi, W) {
      const ctx = this.ctx, cs = this.candles, ind = this.ind, sh = this.show;
      let min = Infinity, max = -Infinity;
      for (let i = s; i <= e; i++) {
        min = Math.min(min, cs[i].low); max = Math.max(max, cs[i].high);
        if (sh.bb && ind.bbUp && ind.bbUp[i] != null) { max = Math.max(max, ind.bbUp[i]); min = Math.min(min, ind.bbLo[i]); }
        if (sh.ma) for (const k of ["ma5", "ma20", "ma60"]) if (ind[k] && ind[k][i] != null) { max = Math.max(max, ind[k][i]); min = Math.min(min, ind[k][i]); }
      }
      const pad = (max - min) * 0.06;
      min -= pad; max += pad;
      const f = this._scale(p, min, max, 34, 8);
      this._grid(p, f, min, max, W);

      // 布林通道
      if (sh.bb && ind.bbUp) {
        ctx.fillStyle = "rgba(99,102,241,0.08)";
        ctx.beginPath();
        let first = true;
        for (let i = s; i <= e; i++) if (ind.bbUp[i] != null) { first ? ctx.moveTo(x(i), f(ind.bbUp[i])) : ctx.lineTo(x(i), f(ind.bbUp[i])); first = false; }
        for (let i = e; i >= s; i--) if (ind.bbLo[i] != null) ctx.lineTo(x(i), f(ind.bbLo[i]));
        ctx.closePath(); ctx.fill();
        this._line(ind.bbUp, s, e, x, f, C.bb, 1.1);
        this._line(ind.bbLo, s, e, x, f, C.bb, 1.1);
        this._line(ind.bbMid, s, e, x, f, C.bb, 1, [4, 3]);
      }

      // K 線
      const cw = Math.max(1, Math.min(14, bw * 0.68));
      for (let i = s; i <= e; i++) {
        const c = cs[i];
        const col = c.close >= c.open ? UP : DOWN;
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
        const cx = Math.round(x(i)) + 0.5;
        ctx.beginPath(); ctx.moveTo(cx, f(c.high)); ctx.lineTo(cx, f(c.low)); ctx.stroke();
        const y1 = f(Math.max(c.open, c.close)), y2 = f(Math.min(c.open, c.close));
        ctx.fillRect(cx - cw / 2, y1, cw, Math.max(1, y2 - y1));
      }

      // 均線
      if (sh.ma) {
        this._line(ind.ma5, s, e, x, f, C.ma5);
        this._line(ind.ma20, s, e, x, f, C.ma20);
        this._line(ind.ma60, s, e, x, f, C.ma60);
      }

      // 圖上註記（箭頭 + 小字）
      ctx.font = "11px system-ui"; ctx.textAlign = "center";
      for (const m of this.markers) {
        if (m.i < s || m.i > e) continue;
        const c = cs[m.i], cx = x(m.i);
        ctx.fillStyle = m.color;
        if (m.pos === "below") {
          const yy = f(c.low) + 6;
          ctx.beginPath(); ctx.moveTo(cx, yy); ctx.lineTo(cx - 5, yy + 8); ctx.lineTo(cx + 5, yy + 8); ctx.closePath(); ctx.fill();
          if (bw > 3 || m.important) ctx.fillText(m.text, cx, yy + 20);
        } else {
          const yy = f(c.high) - 6;
          ctx.beginPath(); ctx.moveTo(cx, yy); ctx.lineTo(cx - 5, yy - 8); ctx.lineTo(cx + 5, yy - 8); ctx.closePath(); ctx.fill();
          if (bw > 3 || m.important) ctx.fillText(m.text, cx, yy - 12);
        }
      }

      // 圖例
      const c = cs[hi], prev = cs[hi - 1];
      const chg = prev ? (c.close / prev.close - 1) * 100 : 0;
      const col = chg >= 0 ? UP : DOWN;
      this._legend(p, [
        { label: c.time, v: "", color: this.col.strong },
        { label: "開", v: c.open }, { label: "高", v: c.high }, { label: "低", v: c.low },
        { label: "收", v: c.close, color: col },
        { label: (chg >= 0 ? "▲" : "▼") + Math.abs(chg).toFixed(2) + "%", v: "", color: col },
      ]);
      const l2 = [];
      if (sh.ma) l2.push({ label: "MA5", v: ind.ma5?.[hi], color: C.ma5 }, { label: "MA20", v: ind.ma20?.[hi], color: C.ma20 }, { label: "MA60", v: ind.ma60?.[hi], color: C.ma60 });
      if (sh.bb) l2.push({ label: "布林上", v: ind.bbUp?.[hi], color: C.bb }, { label: "下", v: ind.bbLo?.[hi], color: C.bb });
      this._legend({ y: p.y + 16 }, l2);
    }

    _vol(p, s, e, x, bw, hi, W) {
      const ctx = this.ctx, cs = this.candles;
      let max = 0;
      for (let i = s; i <= e; i++) max = Math.max(max, cs[i].volume);
      const f = this._scale(p, 0, max * 1.05, 20, 2);
      const cw = Math.max(1, Math.min(14, bw * 0.68));
      for (let i = s; i <= e; i++) {
        const c = cs[i];
        ctx.fillStyle = c.close >= c.open ? "rgba(229,72,77,.55)" : "rgba(31,157,97,.55)";
        const yy = f(c.volume);
        ctx.fillRect(x(i) - cw / 2, yy, cw, p.y + p.h - 2 - yy);
      }
      this._line(this.ind.volMa, s, e, x, f, "#64748b", 1.2);
      ctx.fillStyle = this.col.text; ctx.font = "11px system-ui"; ctx.textAlign = "left";
      ctx.fillText(fmtVol(max), W - this.axisW + 4, p.y + 24);
      this._legend(p, [
        { label: "成交量", v: fmtVol(cs[hi].volume), color: this.col.strong },
        { label: "20日均量", v: this.ind.volMa?.[hi] != null ? fmtVol(this.ind.volMa[hi]) : null, color: "#64748b" },
      ]);
    }

    _kd(p, s, e, x, bw, hi, W) {
      const f = this._scale(p, 0, 100, 20, 4);
      this._grid(p, f, 0, 100, W, [20, 50, 80]);
      this._band(p, f, 80, 100, "rgba(229,72,77,.06)", W);
      this._band(p, f, 0, 20, "rgba(31,157,97,.07)", W);
      this._line(this.ind.K, s, e, x, f, C.k);
      this._line(this.ind.D, s, e, x, f, C.d);
      this._legend(p, [{ label: "KD(9)", v: "", color: this.col.strong }, { label: "K", v: this.ind.K?.[hi], color: C.k }, { label: "D", v: this.ind.D?.[hi], color: C.d }]);
    }

    _rsi(p, s, e, x, bw, hi, W) {
      const f = this._scale(p, 0, 100, 20, 4);
      this._grid(p, f, 0, 100, W, [30, 50, 70]);
      this._band(p, f, 70, 100, "rgba(229,72,77,.06)", W);
      this._band(p, f, 0, 30, "rgba(31,157,97,.07)", W);
      this._line(this.ind.rsi, s, e, x, f, C.rsi);
      this._legend(p, [{ label: "RSI(14)", v: this.ind.rsi?.[hi], color: C.rsi }]);
    }

    _macd(p, s, e, x, bw, hi, W) {
      const ctx = this.ctx, ind = this.ind;
      let m = 0;
      for (let i = s; i <= e; i++) m = Math.max(m, Math.abs(ind.dif[i]), Math.abs(ind.sig[i]), Math.abs(ind.hist[i]));
      m = m * 1.1 || 1;
      const f = this._scale(p, -m, m, 20, 4);
      this._grid(p, f, -m, m, W, [0]);
      const cw = Math.max(1, Math.min(10, bw * 0.55));
      for (let i = s; i <= e; i++) {
        const h = ind.hist[i];
        ctx.fillStyle = h >= 0 ? "rgba(229,72,77,.6)" : "rgba(31,157,97,.6)";
        const y0 = f(0), y1 = f(h);
        ctx.fillRect(x(i) - cw / 2, Math.min(y0, y1), cw, Math.abs(y1 - y0) || 1);
      }
      this._line(ind.dif, s, e, x, f, C.dif);
      this._line(ind.sig, s, e, x, f, C.sig);
      this._legend(p, [{ label: "MACD", v: "", color: this.col.strong }, { label: "DIF", v: ind.dif?.[hi], color: C.dif }, { label: "訊號線", v: ind.sig?.[hi], color: C.sig }, { label: "柱", v: ind.hist?.[hi], color: ind.hist?.[hi] >= 0 ? UP : DOWN }]);
    }
    _band(p, f, a, b, color, W) {
      this.ctx.fillStyle = color;
      this.ctx.fillRect(0, f(b), W - this.axisW, f(a) - f(b));
    }
  }

  function niceTicks(min, max, n) {
    const span = max - min;
    if (!(span > 0)) return [min];
    const raw = span / n;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => span / st <= n + 1) || mag * 10;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function fmtAxis(v) {
    const a = Math.abs(v);
    if (a >= 10000) return v.toFixed(0);
    if (a >= 1000) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    return v.toFixed(3);
  }
  function fmtVol(v) {
    if (v >= 1e8) return (v / 1e8).toFixed(2) + "億";
    if (v >= 1e4) return (v / 1e4).toFixed(0) + "萬";
    return String(Math.round(v));
  }

  window.StockChart = StockChart;
  window.CHART_COLORS = { UP, DOWN, ...C };
})();
