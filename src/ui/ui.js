// DOM overlay: screens, menus, HUD, callouts.
//
// The HUD refreshes at ~20 Hz, not once a frame. Nothing here is allowed to touch
// layout during the render callback.

const $ = (id) => document.getElementById(id);

const SCREENS = ["boot", "title", "tracks", "howto", "settings", "pause", "result"];

export class UI {
  constructor({ onAction }) {
    this.onAction = onAction;
    this.current = "boot";
    this.el = {};
    for (const s of SCREENS) this.el[s] = $(s);

    this.hud = $("hud");
    this.progFill = $("progFill");
    this.progBest = $("progBest");
    this.hudPct = $("hudPct");
    this.hudScore = $("hudScore");
    this.hudSection = $("hudSection");
    this.hudHeat = $("hudHeat");
    this.hudHeatVal = this.hudHeat.querySelector("b");
    this.hudChain = $("hudChain");
    this.calloutEl = $("callout");
    this.toastEl = $("toast");
    this.perfEl = $("perf");

    this._hudAcc = 0;
    this._lastPct = -1;
    this._lastScore = -1;
    this._calloutTimer = 0;
    this._toastTimer = 0;
    this._menuIndex = 0;

    this._bind();
  }

  /* ------------------------------------------------------------------ */

  _bind() {
    document.body.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.id === "bootBtn") return this.onAction({ type: "boot" });
      if (btn.dataset.mode) return this.onAction({ type: "mode", mode: btn.dataset.mode });
      if (btn.dataset.track) return this.onAction({ type: "track", id: btn.dataset.track });
      if (btn.dataset.back) return this.onAction({ type: "back", to: btn.dataset.back });
      if (btn.dataset.pause) return this.onAction({ type: "pause", action: btn.dataset.pause });
      if (btn.dataset.res) return this.onAction({ type: "result", action: btn.dataset.res });
      if (btn.dataset.practice) return this.onAction({ type: "practice", at: Number(btn.dataset.practice) });
      if (btn.id === "setReset") return this.onAction({ type: "resetProgress" });
    });
  }

  /* ------------------------------------------------------------------ */

  show(name) {
    for (const s of SCREENS) this.el[s]?.classList.toggle("hidden", s !== name);
    this.current = name;
    this._menuIndex = 0;
    this._syncMenuSelection();
  }

  hideAll() {
    for (const s of SCREENS) this.el[s]?.classList.add("hidden");
    this.current = null;
  }

  setHudVisible(on) {
    this.hud.classList.toggle("hidden", !on);
  }

  /* ---- keyboard menu navigation ------------------------------------ */

  _items() {
    const screen = this.el[this.current];
    if (!screen) return [];
    return [...screen.querySelectorAll("button:not(:disabled)")];
  }

  _syncMenuSelection() {
    const items = this._items();
    items.forEach((b, i) => b.classList.toggle("sel", i === this._menuIndex));
  }

  moveMenu(delta) {
    const items = this._items();
    if (!items.length) return false;
    this._menuIndex = (this._menuIndex + delta + items.length) % items.length;
    this._syncMenuSelection();
    return true;
  }

  activateMenu() {
    const items = this._items();
    const btn = items[this._menuIndex];
    if (!btn) return false;
    btn.click();
    return true;
  }

  /* ---- HUD ---------------------------------------------------------- */

  updateHud(world, dt, bestPct) {
    this._hudAcc += dt;
    if (this._hudAcc < 0.05) return;
    this._hudAcc = 0;

    const pct = Math.floor(world.progress * 100);
    if (pct !== this._lastPct) {
      this._lastPct = pct;
      this.hudPct.textContent = pct;
      this.progFill.style.width = `${world.progress * 100}%`;
    }

    const score = Math.floor(world.score);
    if (score !== this._lastScore) {
      this._lastScore = score;
      this.hudScore.textContent = score.toLocaleString("en-US");
    }

    const heat = world.heat;
    this.hudHeatVal.textContent = `×${heat.toFixed(1)}`;
    this.hudHeat.classList.toggle("hot", heat >= 4);

    this.hudChain.textContent = world.chain > 1 ? `${world.chain} CHAIN` : "";

    if (bestPct > 0.02) {
      this.progBest.classList.add("on");
      this.progBest.style.left = `${bestPct * 100}%`;
    } else {
      this.progBest.classList.remove("on");
    }
  }

  setSection(name) {
    this.hudSection.textContent = name || "";
  }

  /* ---- callouts ----------------------------------------------------- */

  callout(text, { tiny = false, color = "" } = {}) {
    const el = this.calloutEl;
    el.classList.remove("show");
    // force reflow so the animation restarts
    void el.offsetWidth;
    el.textContent = text;
    el.classList.toggle("tiny", tiny);
    el.style.color = color || "";
    el.classList.add("show");
  }

  toast(text, ms = 1600) {
    const el = this.toastEl;
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove("show"), ms);
  }

  setPerf(text) {
    if (!text) {
      this.perfEl.classList.add("hidden");
      return;
    }
    this.perfEl.classList.remove("hidden");
    this.perfEl.textContent = text;
  }

  /* ---- track list ---------------------------------------------------- */

  buildTracks(tracks, store) {
    const menu = $("trackMenu");
    menu.innerHTML = "";
    tracks.forEach((t, i) => {
      const unlocked = store.isUnlocked(tracks, i);
      const rec = store.data.tracks[t.id] || { bestPct: 0, bestScore: 0, clears: 0 };
      const btn = document.createElement("button");
      btn.className = "menu-item" + (unlocked ? "" : " ghost");
      btn.disabled = !unlocked;
      btn.dataset.track = t.id;
      const pct = Math.floor(rec.bestPct * 100);
      btn.innerHTML = `
        <span class="mi-key">${String(i + 1).padStart(2, "0")}</span>
        <span class="mi-body">
          <b>${t.name}</b>
          <i>${unlocked ? t.tag : "이전 트랙 60% 도달 시 해금"}</i>
          <span class="track-bar"><i style="width:${pct}%"></i></span>
        </span>
        <span class="mi-meta">${
          unlocked
            ? (rec.clears > 0 ? `<b>CLEAR</b><br>` : "") + `${pct}%<br>${rec.bestScore ? rec.bestScore.toLocaleString("en-US") : "—"}`
            : `<span class="mi-lock">LOCKED</span>`
        }</span>`;
      menu.appendChild(btn);
    });
    const back = document.createElement("button");
    back.className = "menu-item ghost";
    back.dataset.back = "title";
    back.innerHTML = `<span class="mi-key">←</span><span class="mi-body"><b>BACK</b></span>`;
    menu.appendChild(back);
  }

  updateModeMeta(store, tracks) {
    const cleared = tracks.filter((t) => (store.data.tracks[t.id]?.clears || 0) > 0).length;
    $("metaTracks").innerHTML = `<b>${cleared}</b> / ${tracks.length}`;
    const e = store.data.endless;
    $("metaEndless").innerHTML = e.bestScore ? `<b>${e.bestScore.toLocaleString("en-US")}</b>` : "—";
  }

  setDailyMeta(seedId, rec) {
    $("metaDaily").innerHTML = rec.bestScore
      ? `<b>${rec.bestScore.toLocaleString("en-US")}</b><br>${Math.floor(rec.bestPct * 100)}%`
      : seedId.slice(-4);
  }

  /* ---- result -------------------------------------------------------- */

  showResult(data) {
    const { pct, score, chain, graze, perfect, cleared, broke, bestPct, mode, practiceMax } = data;
    $("resVerdict").textContent = cleared ? "TRACK CLEAR" : broke.pct ? "NEW BEST" : "DOWN";
    $("resVerdict").className = "result-verdict" + (cleared ? " clear" : broke.pct ? " best" : "");
    $("resPct").textContent = Math.floor(pct * 100);
    $("resScore").textContent = Math.floor(score).toLocaleString("en-US");
    $("resChain").textContent = chain;
    $("resGraze").textContent = graze;
    $("resPerfect").textContent = perfect;

    const lines = [];
    if (broke.score) lines.push("NEW HIGH SCORE");
    else if (bestPct > 0) lines.push(`BEST ${Math.floor(bestPct * 100)}%`);
    if (broke.firstClear) lines.push("FIRST CLEAR");
    $("resBestLine").textContent = lines.join("   ·   ");

    // Practice checkpoints, capped at what the player has actually reached.
    const row = $("practiceRow");
    const marks = $("practiceMarks");
    const showPractice = mode === "track";
    $("btnPractice").classList.toggle("hidden", !showPractice);
    row.classList.add("hidden");
    if (showPractice) {
      marks.innerHTML = "";
      for (let i = 0; i <= 9; i++) {
        const at = i / 10;
        const b = document.createElement("button");
        b.dataset.practice = String(at);
        b.textContent = `${i * 10}%`;
        b.disabled = at > (practiceMax ?? 0) + 0.001;
        marks.appendChild(b);
      }
    }
    this.show("result");
  }

  togglePracticeRow() {
    $("practiceRow").classList.toggle("hidden");
  }
}
