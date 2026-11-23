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

  function toast(msg, ok) {
    var t = $("toast");
    t.textContent = msg;
    t.className = "toast " + (ok ? "ok" : "bad");
    setTimeout(function () { t.className = "toast hidden"; }, 2800);
  }

  function setStep(n) {
    document.querySelectorAll(".step").forEach(function (b) {
      var s = Number(b.getAttribute("data-step"));
      b.classList.toggle("on", s === n);
      b.classList.toggle("done", s < n);
    });
    document.querySelectorAll(".panel").forEach(function (p) {
      p.classList.toggle("on", p.getAttribute("data-panel") === String(n));
    });
    if (n === 4) {
      fillReview();
      refreshReviewProbeMsg();
    }
  }

  document.querySelectorAll(".step").forEach(function (b) {
    b.addEventListener("click", function () {
      setStep(Number(b.getAttribute("data-step")));
    });
  });

  $("next-1").addEventListener("click", function () {
    if (!termsAlreadyAccepted && !$("terms_accept").checked) {
      toast("Please accept the EULA to continue", false);
      return;
    }
    setStep(2);
  });
  $("next-2").addEventListener("click", function () {
    if (!probeState.db) {
      toast("Test the database connection first", false);
      return;
    }
    setStep(3);
  });
  $("next-3").addEventListener("click", function () {
    if (!probeState.dest) {
      toast("Test the destination connection first", false);
      return;
    }
    setStep(4);
  });
  $("back-2").addEventListener("click", function () { setStep(1); });
  $("back-3").addEventListener("click", function () { setStep(2); });
  $("back-4").addEventListener("click", function () { setStep(3); });

  function toggleDest() {
    var mode = $("dest_mode").value;
    ["local", "s3", "azure", "webdav", "sftp"].forEach(function (k) {
      var el = document.getElementById("dest-" + k);
      if (el) el.classList.toggle("on", k === mode);
    });
  }
  $("dest_mode").addEventListener("change", function () {
    toggleDest();
    probeState.dest = false;
    refreshReviewProbeMsg();
  });
  toggleDest();

  function refreshReviewProbeMsg() {
    var el = $("review-probe-msg");
    if (!el) return;
    var parts = [];
    if (!probeState.db) parts.push("database");
    if (!probeState.dest) parts.push("destination");
    el.textContent = parts.length
      ? "Still need to test: " + parts.join(" and ") + "."
      : "Both probes passed — ready to save.";
  }

  function setProbe(state, msg) {
    probeState.db = !!state;
    var m = $("db-probe-msg");
    if (m) m.textContent = msg || (state ? "Database is reachable." : "Test the connection.");
    refreshReviewProbeMsg();
  }
  function setDestProbe(state, msg) {
    probeState.dest = !!state;
    var m = $("dest-probe-msg");
    if (m) m.textContent = msg || (state ? "Destination is ready." : "Test write access.");
    refreshReviewProbeMsg();
  }

  function runDbTest(btn) if (!$("db_uri").value.trim()) {
        toast("Connection URI is required", false);
        return;
      }
      btn.disabled = true;
      api("/api/test-db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: $("db_type").value, uri: $("db_uri").value.trim() })
      }).then(function (j) {
        if (j.ok) {
          setProbe(true, j.detail || "Database is reachable");
          toast("Database is reachable", true);
        } else {
          setProbe(false, j.detail || "Database test failed");
          toast(j.detail || "Database test failed", false);
        }
      }).catch(function (e) {
        setProbe(false, String(e.message || e));
        toast(String(e.message || e), false);
      }).then(function () { btn.disabled = false; });
  }
  function runDestTest(btn) {
    btn.disabled = true;
    var body = bodyFromForm().destination;
    api("/api/test-dest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (j) {
      if (j.ok) {
        setDestProbe(true, j.detail || "Destination is ready");
        toast("Destination is ready", true);
      } else {
        setDestProbe(false, j.detail || "Destination test failed");
        toast(j.detail || "Destination test failed", false);
      }
    }).catch(function (e) {
      setDestProbe(false, String(e.message || e));
      toast(String(e.message || e), false);
    }).then(function () { btn.disabled = false; });
  }
  $("btn-test-db").addEventListener("click", function () { runDbTest($("btn-test-db")); });
  $("btn-test-dest").addEventListener("click", function () { runDestTest($("btn-test-dest")); });
  $("btn-review-test-db").addEventListener("click", function () { runDbTest($("btn-review-test-db")); });
  $("btn-review-test-dest").addEventListener("click", function () { runDestTest($("btn-review-test-dest")); });

  function bodyFromForm() {
    return {
      terms_accepted: termsAlreadyAccepted || !!$("terms_accept").checked,
      terms_version: termsVersion,
      name: $("name").value.trim(),
      schedule: $("schedule").value.trim() || "0 3 * * *",
      retention: Number($("retention").value) || 14,
      license: { token: $("token").value.trim() },
      database: {
        type: $("db_type").value,
        uri: $("db_uri").value.trim(),
        backup_type: $("backup_type").value
      },
      destination: {
        mode: $("dest_mode").value,
        local_dir: $("local_dir").value.trim(),
        s3_endpoint: $("s3_endpoint").value.trim(),
        s3_region: $("s3_region").value.trim(),
        s3_bucket: $("s3_bucket").value.trim(),
        s3_prefix: $("s3_prefix").value.trim(),
        s3_access_key: $("s3_access_key").value.trim(),
        s3_secret_key: $("s3_secret_key").value.trim(),
        azure_account: $("azure_account").value.trim(),
        azure_container: $("azure_container").value.trim(),
        azure_key: $("azure_key").value.trim(),
        azure_prefix: $("azure_prefix").value.trim(),
        webdav_url: $("webdav_url").value.trim(),
        webdav_user: $("webdav_user").value.trim(),
        webdav_password: $("webdav_password").value.trim(),
        sftp_host: $("sftp_host").value.trim(),
        sftp_user: $("sftp_user").value.trim(),
        sftp_password: $("sftp_password").value.trim(),
        sftp_key_file: $("sftp_key_file").value.trim(),
        sftp_path: $("sftp_path").value.trim(),
        sftp_insecure: !!($("sftp_insecure") && $("sftp_insecure").checked)
      },
      security: { encrypt: !!$("encrypt").checked }
    };
  }

  function fillReview() {
    var b = bodyFromForm();
    $("review").textContent =
      "Name: " + (b.name || "(unnamed)") + "\n" +
      "Schedule: " + b.schedule + "\n" +
      "License server: https://backup.enadoctemp.workers.dev (fixed)\n" +
      "DB: " + b.database.type + (b.database.uri ? " / URI set" : " / URI missing") + "\n" +
      "Dest: " + b.destination.mode + "\n" +
      "Encrypt: " + b.security.encrypt + "\n" +
      "EULA accepted: " + b.terms_accepted;
  }

  $("btn-save").addEventListener("click", function () {
    if (!termsAlreadyAccepted && !$("terms_accept").checked) {
      toast("Accept the EULA on step 1 before saving", false);
      setStep(1);
      return;
    }
    if (!probeState.db) {
      toast("Test the database connection first", false);
      setStep(2);
      return;
    }
    if (!probeState.dest) {
      toast("Test the destination connection first", false);
      setStep(3);
      return;
    }
    api("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyFromForm())
    }).then(function (j) {
      toast(j.ok ? "Configuration saved" : "Save failed", !!j.ok);
      $("token").value = "";
      return refreshStatus();
    }).catch(function (e) {
      toast(String(e.message || e), false);
    });
  });

  $("btn-license").addEventListener("click", function () {
    api("/api/test-license", { method: "POST" }).then(function (j) {
      toast(j.allowed || j.ok ? "License looks good" : (j.reason || "License check failed"), !!(j.allowed || j.ok));
      return refreshStatus();
    }).catch(function (e) { toast(String(e.message || e), false); });
  });

  $("btn-run").addEventListener("click", function () {
    api("/api/run-once", { method: "POST" }).then(function () {
      toast("Backup started", true);
      setTimeout(refreshHistory, 1500);
    }).catch(function (e) { toast(String(e.message || e), false); });
  });

  function refreshStatus() {
    return api("/api/status").then(function (j) {
      if ($("status")) $("status").textContent = JSON.stringify(j, null, 2);
      var pill = $("status-pill");
      if (j.licenseOk) {
        pill.textContent = "License OK";
        pill.className = "badge ok";
      } else {
        pill.textContent = j.licenseReason || "License";
        pill.className = "badge";
      }
      if ($("kpi-lic")) $("kpi-lic").textContent = j.licenseOk ? "OK" : (j.licenseReason || "—");
      if ($("kpi-db")) $("kpi-db").textContent = (j.database && j.database.ok) ? "Reachable" : "—";
      if ($("kpi-sch")) $("kpi-sch").textContent = j.name ? (j.complete ? "Configured" : "Incomplete") : "—";
      if (j.termsAccepted) {
        termsAlreadyAccepted = true;
        var note = $("terms-note");
        if (note) {
          note.textContent = "Terms already accepted (v" + (j.termsVersion || termsVersion || "?") + ").";
          note.classList.remove("hidden");
        }
        var wrap = $("terms-accept-wrap");
        if (wrap) wrap.classList.add("hidden");
        if ($("terms_accept")) $("terms_accept").checked = true;
      }
    }).catch(function () {});
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

  function refreshHistory() {
    return api("/api/history").then(function (j) {
      var el = $("history");
      if (!el) return;
      var items = j.history || j.items || [];
      if (!items.length) { el.textContent = "No runs yet."; return; }
      el.textContent = items.slice(0, 8).map(function (h) {
        return (h.at || h.time || "") + "  " + (h.status || h.code || "") + "  " + (h.detail || h.message || "");
      }).join("\n");
    }).catch(function () {});
  }

  function refreshStorage() {
    return api("/api/backups").then(function (j) {
      var list = $("storage-list");
      var mode = $("storage-mode");
      if (mode) mode.textContent = j.mode ? ("Mode: " + j.mode) : "";
      var objs = j.objects || j.backups || [];
      if (!list) return;
      if (!objs.length) {
        list.className = "hist-empty";
        list.textContent = "No objects listed yet.";
        return;
      }
      list.className = "";
      list.innerHTML = "";
      objs.forEach(function (o) {
        var row = document.createElement("div");
        row.className = "backup-row";
        var key = o.key || o.Key || "";
        var size = o.size != null ? o.size : o.Size;
        var meta = document.createElement("div");
        meta.innerHTML = "<div>" + key + "</div><div class=\"meta\">" + (size != null ? (Math.round(size / 1024) + " KB") : "") + (o.modTime ? " · " + o.modTime : "") + "</div>";
        var acts = document.createElement("div");
        acts.className = "backup-actions";
        var btnR = document.createElement("button");
        btnR.type = "button";
        btnR.className = "btn btn-ghost";
        btnR.textContent = "Restore";
        btnR.onclick = function () {
          api("/api/backups/get", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: key }) })
            .then(function () { toast("Restore started", true); })
            .catch(function (e) { toast(String toast(String(e.message || e), false); });
        };
        var btnD = document.createElement("button");
        btnD.type = "button";
        btnD.className = "btn btn-ghost";
        btnD.textContent = "Delete";
        btnD.onclick = function () {
          if (!confirm("Delete " + key + "?")) return;
          api("/api/backups/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: key }) })
            .then(function () { toast("Deleted", true); return refreshStorage(); })
            .catch(function (e) { toast(String(e.message || e), false); });
        };
        acts.appendChild(btnR);
        acts.appendChild(btnD);
        row.appendChild(meta);
        row.appendChild(acts);
        list.appendChild(row);
      });
    }).catch(function (e) {
      var list = $("storage-list");
      if (list) { list.className = "hist-empty"; list.textContent = "Could not list: " + (e.message || e); }
    });
  }

  var btnStor = $("btn-refresh-storage");
  if (btnStor) btnStor.addEventListener("click", function () { refreshStorage(); });

  // Load existing config into form
  api("/api/config").then(function (c) {
    if (!c) return;
    if (c.name) $("name").value = c.name;
    if (c.schedule) $("schedule").value = c.schedule;
    if (c.retention) $("retention").value = c.retention;
    if (c.database) {
      if (c.database.type) $("db_type").value = c.database.type;
      if (c.database.uri) $("db_uri").value = c.database.uri;
      if (c.database.backup_type) $("backup_type").value = c.database.backup_type;
    }
    if (c.destination) {
      if (c.destination.mode) $("dest_mode").value = c.destination.mode;
      ["local_dir","s3_endpoint","s3_region","s3_bucket","s3_prefix","s3_access_key","azure_account","azure_container","azure_prefix","webdav_url","webdav_user","sftp_host","sftp_user","sftp_path","sftp_key_file"].forEach(function (k) {
        if (c.destination[k] != null && $(k)) $(k).value = c.destination[k];
      });
      if ($("sftp_insecure") && typeof c.destination.sftp_insecure === "boolean") {
        $("sftp_insecure").checked = !!c.destination.sftp_insecure;
      }
      toggleDest();
    }
    if (c.security && typeof c.security.encrypt === "boolean") $("encrypt").checked = !!c.security.encrypt;
    if (c.terms_accepted && c.terms_version && c.terms_version === termsVersion) {
      termsAlreadyAccepted = true;
    }
  }).catch(function () {});

  loadTerms();
  refreshStatus();
  refreshHistory();
  refreshStorage();
  setInterval(function () {
    refreshStatus();
    refreshHistory();
    refreshStorage();
  }, 8000);
})();
