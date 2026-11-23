(function () {
  function $(id) { return document.getElementById(id); }
  function api(url, opt) {
    return fetch(url, opt || {}).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok && j && j.error) throw new Error(j.error);
        return j;
      });
    });
  }

  var probeState = { db: false, dest: false };
  var termsVersion = "";
  var termsAlreadyAccepted = false;

  function showMsg(el, text, ok) {
    if (!el) return;
    el.textContent = text || "";
    el.className = "msg show " + (ok ? "ok" : "err");
  }
  function clearMsg(el) {
    if (!el) return;
    el.textContent = "";
    el.className = "msg";
  }

  function setStep(n) {
    document.querySelectorAll(".step").forEach(function (b) {
      var s = parseInt(b.getAttribute("data-step"), 10);
      b.classList.toggle("on", s === n);
      b.classList.toggle("done", s < n);
    });
    document.querySelectorAll("[data-panel]").forEach(function (p) {
      p.classList.toggle("hidden", parseInt(p.getAttribute("data-panel"), 10) !== n);
    });
  }

  function bodyFromForm() {
    var fd = new FormData($("cfg-form"));
    var o = {};
    fd.forEach(function (v, k) { o[k] = v; });
    o.sftp_insecure = !!($("sftp_insecure") && $("sftp_insecure").checked);
    if (termsVersion) o.terms_version = termsVersion;
    if ($("terms_accept") && $("terms_accept").checked) o.terms_accepted = true;
    return o;
  }

  function loadTerms() {
    return api("/api/terms").then(function (j) {
      termsVersion = j.version || j.terms_version || "";
      var box = $("terms-text");
      if (box) box.textContent = j.text || j.terms || "See console for license terms.";
      if (j.accepted || j.terms_accepted) {
        termsAlreadyAccepted = true;
        var note = $("terms-note");
        if (note) {
          note.textContent = "Terms already accepted (v" + (termsVersion || "?") + ").";
          note.classList.remove("hidden");
        }
        var wrap = $("terms-accept-wrap");
        if (wrap) wrap.classList.add("hidden");
        if ($("terms_accept")) $("terms_accept").checked = true;
      }
    }).catch(function () {
      var box = $("terms-text");
      if (box) box.textContent = "Could not load terms. You can still proceed after accepting below.";
    });
  }

  function refreshStatus() {
    return api("/api/status").then(function (j) {
      var pill = $("status-pill");
      if (pill) {
        if (j.licensed || j.license_ok) {
          pill.textContent = "License OK";
          pill.classList.add("ok");
        } else {
          pill.textContent = j.status || "Not licensed";
          pill.classList.remove("ok");
        }
      }
      if ($("stat-license")) $("stat-license").textContent = (j.licensed || j.license_ok) ? "Valid" : (j.license_error || "—");
      if ($("stat-next")) $("stat-next").textContent = j.next_run || j.nextRun || "—";
      if ($("stat-last")) $("stat-last").textContent = j.last_status || j.lastStatus || "—";
    }).catch(function () {});
  }

  function refreshHistory() {
    return api("/api/history").then(function () {}).catch(function () {});
  }

  function refreshStorage() {
    var list = $("backups-list");
    if (!list) return;
    return api("/api/backups").then(function (j) {
      var items = j.objects || j.backups || j.items || [];
      if (!items.length) {
        list.innerHTML = "<p class=\"hint\">No objects found (or destination not configured).</p>";
        return;
      }
      list.innerHTML = items.map(function (it) {
        var name = it.key || it.name || it.path || "object";
        var size = it.size_human || it.size || "";
        return "<div class=\"backup-row\"><div><div>" + name + "</div><div class=\"meta\">" + size + "</div></div>" +
          "<div class=\"backup-actions\">" +
          "<button type=\"button\" class=\"btn\" data-restore=\"" + encodeURIComponent(name) + "\">Restore</button>" +
          "<button type=\"button\" class=\"btn\" data-delete=\"" + encodeURIComponent(name) + "\">Delete</button>" +
          "</div></div>";
      }).join("");
    }).catch(function (e) {
      list.innerHTML = "<p class=\"hint\">" + (e.message || "Failed to list") + "</p>";
    });
  }

  function gateTerms() {
    if (termsAlreadyAccepted) return true;
    if ($("terms_accept") && $("terms_accept").checked) return true;
    alert("Please accept the EULA to continue.");
    return false;
  }

  document.querySelectorAll(".step").forEach(function (b) {
    b.addEventListener("click", function () {
      setStep(parseInt(b.getAttribute("data-step"), 10));
    });
  });
  document.querySelectorAll("[data-prev]").forEach(function (b) {
    b.addEventListener("click", function () {
      setStep(parseInt(b.getAttribute("data-prev"), 10));
    });
  });

  $("next-1") && $("next-1").addEventListener("click", function () {
    if (!gateTerms()) return;
    setStep(2);
  });
  $("next-2") && $("next-2").addEventListener("click", function () { setStep(3); });
  $("next-3") && $("next-3").addEventListener("click", function () { setStep(4); });

  function showDest(type) {
    ["s3", "azure", "webdav", "sftp", "local"].forEach(function (t) {
      var el = $("dest-" + t);
      if (el) el.classList.toggle("hidden", t !== type);
    });
  }
  if ($("dest_type")) {
    $("dest_type").addEventListener("change", function () { showDest($("dest_type").value); });
    showDest($("dest_type").value);
  }

  $("btn-test-db") && $("btn-test-db").addEventListener("click", function () {
    clearMsg($("msg-db"));
    api("/api/test-db", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bodyFromForm()) })
      .then(function () { probeState.db = true; showMsg($("msg-db"), "Connection OK", true); })
      .catch(function (e) { showMsg($("msg-db"), e.message || "Failed", false); });
  });

  $("btn-test-dest") && $("btn-test-dest").addEventListener("click", function () {
    clearMsg($("msg-dest"));
    api("/api/test-dest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bodyFromForm()) })
      .then(function () { probeState.dest = true; showMsg($("msg-dest"), "Destination OK", true); })
      .catch(function (e) { showMsg($("msg-dest"), e.message || "Failed", false); });
  });

  $("btn-save") && $("btn-save").addEventListener("click", function () {
    if (!gateTerms()) return;
    clearMsg($("msg-review"));
    api("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bodyFromForm()) })
      .then(function () { showMsg($("msg-review"), "Configuration saved", true); refreshStatus(); })
      .catch(function (e) { showMsg($("msg-review"), e.message || "Save failed", false); });
  });

  $("btn-license") && $("btn-license").addEventListener("click", function () {
    clearMsg($("msg-review"));
    api("/api/license-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bodyFromForm()) })
      .then(function () { showMsg($("msg-review"), "License OK", true); refreshStatus(); })
      .catch(function (e) { showMsg($("msg-review"), e.message || "License check failed", false); });
  });

  $("btn-run") && $("btn-run").addEventListener("click", function () {
    if (!gateTerms()) return;
    clearMsg($("msg-review"));
    api("/api/run-once", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bodyFromForm()) })
      .then(function () { showMsg($("msg-review"), "Backup started", true); refreshStatus(); })
      .catch(function (e) { showMsg($("msg-review"), e.message || "Run failed", false); });
  });

  $("btn-list-backups") && $("btn-list-backups").addEventListener("click", function () { refreshStorage(); });

  document.addEventListener("click", function (ev) {
    var t = ev.target;
    if (t && t.getAttribute && t.getAttribute("data-restore")) {
      var key = decodeURIComponent(t.getAttribute("data-restore"));
      api("/api/backups/get", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: key }) })
        .then(function () { alert("Restore requested for " + key); })
        .catch(function (e) { alert(e.message || "Restore failed"); });
    }
    if (t && t.getAttribute && t.getAttribute("data-delete")) {
      var key2 = decodeURIComponent(t.getAttribute("data-delete"));
      if (!confirm("Delete " + key2 + "?")) return;
      api("/api/backups/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: key2 }) })
        .then(function () { refreshStorage(); })
        .catch(function (e) { alert(e.message || "Delete failed"); });
    }
  });

  loadTerms();
  refreshStatus();
  setInterval(function () {
    refreshStatus();
    refreshHistory();
    refreshStorage();
  }, 8000);
})();
