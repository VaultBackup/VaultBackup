#!/usr/bin/env node
/** Turn Connect Database modal into a 3-step wizard (one step visible at a time). */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

if (s.includes("/* __DB_WIZARD__ */")) {
  console.log("wizard already present");
  process.exit(0);
}

const inject = `
/* __DB_WIZARD__ */
(function () {
  function $(id) { return document.getElementById(id); }
  var state = { step: 1, max: 3 };

  function stepPanels() {
    return [
      document.querySelector("[data-db-step='1']"),
      document.querySelector("[data-db-step='2']"),
      document.querySelector("[data-db-step='3']"),
    ];
  }

  function ensureStructure() {
    if (document.querySelector("[data-db-step='1']")) return true;
    var body = document.querySelector("#db-modal-title");
    if (!body) return false;
    // Find scrollable modal body: parent chain
    var modalRoot = body.closest(".fixed") || body.closest("[class*='modal']") || body.parentElement;
    var scroll = null;
    if (modalRoot) {
      scroll = modalRoot.querySelector(".overflow-y-auto");
    }
    if (!scroll) {
      // fallback: next sibling structure from header
      var header = body.closest("div");
      while (header && !header.parentElement) header = header.parentElement;
    }
    if (!scroll) return false;

    var kids = Array.prototype.slice.call(scroll.children);
    // Heuristic: group by step headers containing Connection / Backup / Retention
    var groups = [[], [], []];
    var idx = 0;
    kids.forEach(function (el) {
      var t = (el.textContent || "").toLowerCase();
      if (t.indexOf("backup plan") >= 0 && t.indexOf("step") >= 0 || /^\\s*2\\b/.test(t) && t.indexOf("backup") >= 0) idx = 1;
      if (t.indexOf("retention") >= 0 && (t.indexOf("step") >= 0 || t.indexOf("3") >= 0)) idx = 2;
      // also detect section titles only
      var h = el.querySelector && el.querySelector("p,h2,h3,label");
      var ht = h ? (h.textContent || "").toLowerCase() : "";
      if (ht.indexOf("connection") >= 0 && (ht.indexOf("1") >= 0 || ht.indexOf("step") >= 0)) idx = 0;
      if (ht.indexOf("backup") >= 0 && (ht.indexOf("2") >= 0 || ht.indexOf("plan") >= 0)) idx = 1;
      if (ht.indexOf("retention") >= 0) idx = 2;
      groups[idx].push(el);
    });

    // If grouping failed (everything in 0), split by known markers in text
    if (groups[1].length === 0 && groups[2].length === 0 && kids.length > 2) {
      groups = [[], [], []];
      idx = 0;
      kids.forEach(function (el) {
        var t = (el.textContent || "").toLowerCase();
        if (t.indexOf("backup plan") >= 0 || t.indexOf("add a backup job") >= 0) idx = Math.max(idx, 1);
        if (t.indexOf("retention") >= 0 && t.indexOf("day") >= 0 || t.indexOf("keep") >= 0 && t.indexOf("backup") >= 0) {
          /* keep */
        }
        if (t.indexOf("step 2") >= 0 || t.indexOf("2 · backup") >= 0 || t.indexOf("2 · backup") >= 0) idx = 1;
        if (t.indexOf("step 3") >= 0 || t.indexOf("3 · retention") >= 0 || t.indexOf("retention") === 0) idx = 2;
        // header-only nodes
        var plain = (el.innerText || "").trim().toLowerCase();
        if (plain.indexOf("step 2") === 0 || plain.indexOf("2 ·") === 0) idx = 1;
        if (plain.indexOf("step 3") === 0 || plain.indexOf("3 ·") === 0) idx = 2;
        groups[idx].push(el);
      });
    }

    scroll.innerHTML = "";
    for (var i = 0; i < 3; i++) {
      var panel = document.createElement("div");
      panel.setAttribute("data-db-step", String(i + 1));
      panel.className = "db-wiz-panel space-y-4";
      groups[i].forEach(function (el) { panel.appendChild(el); });
      if (!groups[i].length) {
        panel.innerHTML = "<p class='text-xs text-slate-500'>Continue to configure this step.</p>";
      }
      scroll.appendChild(panel);
    }
    return true;
  }

  function renderStepsBar() {
    var el = $("db-modal-steps");
    if (!el) return;
    el.className = "db-wiz-steps mt-2 flex flex-wrap items-center gap-2";
    el.innerHTML = [1, 2, 3]
      .map(function (n) {
        var labels = { 1: "Connection", 2: "Backup plan", 3: "Retention" };
        var on = state.step === n;
        return (
          '<button type="button" data-goto-step="' +
          n +
          '" class="db-wiz-step ' +
          (on ? "is-on" : "") +
          (n < state.step ? " is-done" : "") +
          '">' +
          '<span class="db-wiz-num">' +
          n +
          "</span>" +
          labels[n] +
          "</button>"
        );
      })
      .join("");
    el.querySelectorAll("[data-goto-step]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var n = parseInt(btn.getAttribute("data-goto-step"), 10);
        if (n >= 1 && n <= state.max) {
          state.step = n;
          showStep();
        }
      });
    });
  }

  function showStep() {
    ensureStructure();
    var panels = stepPanels();
    panels.forEach(function (p, i) {
      if (!p) return;
      p.style.display = i + 1 === state.step ? "block" : "none";
    });
    renderStepsBar();

    var back = $("btn-db-back");
    var next = $("btn-db-next");
    var test = $("btn-test-db");
    var save = $("btn-save-db");
    if (back) back.style.display = state.step === 1 ? "none" : "inline-flex";
    if (next) next.style.display = state.step === state.max ? "none" : "inline-flex";
    if (test) test.style.display = state.step === 1 ? "inline-flex" : "none";
    if (save) save.style.display = state.step === state.max ? "inline-flex" : "none";
  }

  function ensureNavButtons() {
    if ($("btn-db-next")) return;
    var test = $("btn-test-db");
    if (!test || !test.parentElement) return;
    var parent = test.parentElement;

    var back = document.createElement("button");
    back.id = "btn-db-back";
    back.type = "button";
    back.className =
      "px-4 py-2.5 bg-slate-800/80 hover:bg-slate-800 text-xs font-medium rounded-xl text-slate-300 border border-slate-700/80 transition";
    back.textContent = "Back";
    back.addEventListener("click", function () {
      if (state.step > 1) {
        state.step--;
        showStep();
      }
    });

    var next = document.createElement("button");
    next.id = "btn-db-next";
    next.type = "button";
    next.className =
      "px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-xs font-semibold rounded-xl text-white shadow-[0_0_20px_rgba(34,197,94,0.15)] transition";
    next.textContent = "Continue";
    next.addEventListener("click", function () {
      if (state.step === 1) {
        var name = $("new-db-name");
        var url = $("new-db-url") || document.querySelector("textarea[id*='db']");
        if (name && !String(name.value || "").trim()) {
          name.focus();
          return;
        }
      }
      if (state.step < state.max) {
        state.step++;
        showStep();
      }
    });

    parent.insertBefore(back, test);
    parent.insertBefore(next, test);
  }

  function bootWizard() {
    if (!$("db-modal-title")) return;
    ensureNavButtons();
    state.step = 1;
    showStep();
  }

  // Re-init when modal is opened (title changes / display)
  var obs = new MutationObserver(function () {
    var title = $("db-modal-title");
    if (!title) return;
    var root = title.closest(".fixed");
    if (root && root.offsetParent !== null) {
      bootWizard();
    }
  });
  if (document.body) {
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
  }

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t) return;
    var btn = t.closest && t.closest("button,a");
    if (!btn) return;
    var label = (btn.textContent || "").toLowerCase();
    if (label.indexOf("connect database") >= 0 || label.indexOf("add database") >= 0 || (btn.id && btn.id.indexOf("db") >= 0 && label.indexOf("add") >= 0)) {
      setTimeout(bootWizard, 50);
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(bootWizard, 100);
    });
  } else {
    setTimeout(bootWizard, 100);
  }
})();
`;

const css = `
/* __DB_WIZARD_CSS__ */
.db-wiz-steps { gap: 0.5rem; }
.db-wiz-step {
  display: inline-flex; align-items: center; gap: 0.4rem;
  border: 1px solid rgb(51 65 85); background: rgb(15 23 42);
  color: rgb(148 163 184); font-size: 11px; font-weight: 600;
  padding: 0.35rem 0.65rem; border-radius: 999px; cursor: pointer;
}
.db-wiz-step .db-wiz-num {
  width: 1.15rem; height: 1.15rem; border-radius: 999px;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgb(30 41 59); font-size: 10px;
}
.db-wiz-step.is-on {
  border-color: rgba(34,197,94,0.55); background: rgba(34,197,94,0.12); color: rgb(167 243 208);
}
.db-wiz-step.is-on .db-wiz-num { background: rgb(22 163 74); color: white; }
.db-wiz-step.is-done { border-color: rgba(34,197,94,0.25); color: rgb(167 243 208); }
.db-wiz-panel { animation: dbWizIn 0.18s ease-out; }
@keyframes dbWizIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
`;

// Inject CSS before first </style>
if (s.includes("</style>") && !s.includes("__DB_WIZARD_CSS__")) {
  s = s.replace("</style>", css + "\n</style>");
  console.log("wizard CSS injected");
}

// Inject JS before final </script> of page (last occurrence)
const idx = s.lastIndexOf("</script>");
if (idx === -1) {
  console.error("no script end");
  process.exit(1);
}
s = s.slice(0, idx) + "\n" + inject + "\n" + s.slice(idx);
console.log("wizard JS injected");

fs.writeFileSync(file, s);
console.log("done", s.length);
